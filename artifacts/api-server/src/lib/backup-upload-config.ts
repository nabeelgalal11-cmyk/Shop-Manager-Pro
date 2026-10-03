const ALLOWED_BACKUP_UPLOAD_URLS = new Set([
  "https://backups.915motorsusa.com/api/backups/upload",
  // Keep the existing relay available during custom-domain DNS setup.
  "https://shop-manager-pro.replit.app/api/backups/upload",
]);

export function isAllowedBackupUploadUrl(value: string | undefined): boolean {
  return value !== undefined && ALLOWED_BACKUP_UPLOAD_URLS.has(value);
}