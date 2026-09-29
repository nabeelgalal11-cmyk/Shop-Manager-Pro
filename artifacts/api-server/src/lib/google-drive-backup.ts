import { open } from "node:fs/promises";

const DRIVE_API = "/drive/v3";
const DRIVE_UPLOAD_API = "/upload/drive/v3";
const FOLDER_NAME = "915 Motors Database Backups";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const CHUNK_SIZE = 8 * 1024 * 1024;

export interface DriveProxyOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export type DriveProxy = (
  path: string,
  options?: DriveProxyOptions,
) => Promise<Response>;

interface DriveFile {
  id: string;
  name: string;
  size?: string;
  mimeType?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

interface DriveFileList {
  files?: DriveFile[];
}

interface DriveUploadInput {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  proxy: DriveProxy;
}

export interface DriveBackupResult {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  webViewLink?: string;
  alreadyUploaded: boolean;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function requestWithRetry(
  proxy: DriveProxy,
  path: string,
  options?: DriveProxyOptions,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await proxy(path, options);
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      if (!retryable || attempt === 2) {
        return response;
      }

      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt === 2) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Google Drive request failed.");
}

async function readDriveJson<T>(
  response: Response,
  operation: string,
): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `Google Drive ${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

async function findOrCreateBackupFolder(proxy: DriveProxy): Promise<string> {
  const query = new URLSearchParams({
    q: `name = '${escapeDriveQuery(FOLDER_NAME)}' and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: "100",
  });
  const listed = await readDriveJson<DriveFileList>(
    await requestWithRetry(proxy, `${DRIVE_API}/files?${query}`),
    "folder lookup",
  );
  const folder = listed.files?.find(
    (file) => file.name === FOLDER_NAME && file.mimeType === FOLDER_MIME_TYPE,
  );
  if (folder?.id) {
    return folder.id;
  }

  const created = await readDriveJson<DriveFile>(
    await requestWithRetry(proxy, `${DRIVE_API}/files?fields=id,name,mimeType`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: FOLDER_MIME_TYPE,
      }),
    }),
    "folder creation",
  );
  if (!created.id) {
    throw new Error("Google Drive returned no folder ID.");
  }
  return created.id;
}

async function findExistingBackup(
  proxy: DriveProxy,
  folderId: string,
  fileName: string,
): Promise<DriveFile | undefined> {
  const query = new URLSearchParams({
    q: `name = '${escapeDriveQuery(fileName)}' and '${escapeDriveQuery(folderId)}' in parents and trashed = false`,
    fields: "files(id,name,size,appProperties,webViewLink)",
    pageSize: "100",
  });
  const listed = await readDriveJson<DriveFileList>(
    await requestWithRetry(proxy, `${DRIVE_API}/files?${query}`),
    "backup lookup",
  );
  return listed.files?.find((file) => file.name === fileName);
}

async function uploadResumable(
  proxy: DriveProxy,
  input: DriveUploadInput,
  folderId: string,
): Promise<DriveFile> {
  const start = await requestWithRetry(
    proxy,
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size,webViewLink`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/octet-stream",
        "X-Upload-Content-Length": String(input.sizeBytes),
      },
      body: JSON.stringify({
        name: input.fileName,
        mimeType: "application/octet-stream",
        parents: [folderId],
        appProperties: {
          backupSha256: input.sha256,
          backupSource: "915motors-render-cron",
        },
      }),
    },
  );

  if (!start.ok) {
    await readDriveJson<never>(start, "resumable upload initialization");
  }

  const location = start.headers.get("location");
  if (!location) {
    throw new Error("Google Drive returned no resumable upload location.");
  }

  const uploadUrl = new URL(location);
  if (
    uploadUrl.origin !== "https://www.googleapis.com" ||
    !uploadUrl.pathname.startsWith(`${DRIVE_UPLOAD_API}/files`)
  ) {
    throw new Error("Google Drive returned an unexpected upload location.");
  }
  const uploadPath = `${uploadUrl.pathname}${uploadUrl.search}`;

  const file = await open(input.filePath, "r");
  try {
    let offset = 0;
    while (offset < input.sizeBytes) {
      const length = Math.min(CHUNK_SIZE, input.sizeBytes - offset);
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(chunk, 0, length, offset);
      if (bytesRead !== length) {
        throw new Error("Backup file changed while it was being uploaded.");
      }

      const end = offset + bytesRead - 1;
      const response = await requestWithRetry(proxy, uploadPath, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${offset}-${end}/${input.sizeBytes}`,
        },
        body: chunk,
      });

      if (response.status === 308) {
        if (response.headers.get("range") !== `bytes=0-${end}`) {
          throw new Error("Google Drive did not acknowledge the complete upload chunk.");
        }
        offset += bytesRead;
        continue;
      }

      if (!response.ok) {
        await readDriveJson<never>(response, "backup upload");
      }
      if (offset + bytesRead !== input.sizeBytes) {
        throw new Error("Google Drive finalized the backup before all bytes were sent.");
      }

      return await readDriveJson<DriveFile>(response, "backup upload");
    }
  } finally {
    await file.close();
  }

  throw new Error("Google Drive did not finalize the backup upload.");
}

export async function uploadDatabaseBackupToDrive(
  input: DriveUploadInput,
): Promise<DriveBackupResult> {
  const folderId = await findOrCreateBackupFolder(input.proxy);
  const existing = await findExistingBackup(input.proxy, folderId, input.fileName);

  if (existing) {
    const existingHash = existing.appProperties?.backupSha256;
    if (
      existing.id &&
      existingHash === input.sha256 &&
      Number(existing.size) === input.sizeBytes
    ) {
      return {
        fileId: existing.id,
        fileName: existing.name,
        sizeBytes: input.sizeBytes,
        webViewLink: existing.webViewLink,
        alreadyUploaded: true,
      };
    }
    throw new Error("A different backup already exists with this file name.");
  }

  const uploaded = await uploadResumable(input.proxy, input, folderId);
  if (!uploaded.id) {
    throw new Error("Google Drive returned no uploaded file ID.");
  }

  return {
    fileId: uploaded.id,
    fileName: uploaded.name || input.fileName,
    sizeBytes: Number(uploaded.size) || input.sizeBytes,
    webViewLink: uploaded.webViewLink,
    alreadyUploaded: false,
  };
}