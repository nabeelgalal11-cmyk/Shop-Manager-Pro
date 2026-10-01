import { useEffect, useState } from "react";
import { AlertTriangle, Database, Download, HardDriveUpload, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BackupStatus = {
  enabled: boolean;
  reason?: string;
  environment?: string;
  target: { host: string; database: string } | null;
};

type ProductionBackupStatus = {
  available: boolean;
  reason?: string;
  configured: boolean;
  lastSuccessDate: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};

const RESTORE_CONFIRMATION = "RESTORE DEVELOPMENT DATABASE";

export default function SettingsBackups() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [productionStatus, setProductionStatus] = useState<ProductionBackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [archive, setArchive] = useState<File | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/backups/development", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to check backup availability.");
        return await response.json() as BackupStatus;
      })
      .then((data) => { if (active) setStatus(data); })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : "Unable to check backup availability.");
      })
      .finally(() => { if (active) setLoading(false); });
    fetch("/api/backups/production-status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Production backup status is unavailable.");
        return await response.json() as ProductionBackupStatus;
      })
      .then((data) => { if (active) setProductionStatus(data); })
      .catch(() => { if (active) setProductionStatus(null); });
    return () => { active = false; };
  }, []);

  const restore = async () => {
    if (!archive || !status?.enabled || !acknowledged || confirmationText !== RESTORE_CONFIRMATION) return;
    setRestoring(true);
    setMessage("");
    try {
      const response = await fetch("/api/backups/development/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Backup-Filename": archive.name,
          "X-Restore-Confirmation": RESTORE_CONFIRMATION,
        },
        body: archive,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Restore failed.");
      setMessage(`Restore completed for ${result.target.database} on ${result.target.host}. Sign in again if restored staff accounts differ.`);
      setArchive(null);
      setConfirmationText("");
      setAcknowledged(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setRestoring(false);
    }
  };

  const canRestore = Boolean(
    status?.enabled &&
    archive &&
    acknowledged &&
    confirmationText === RESTORE_CONFIRMATION &&
    !restoring,
  );

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-8">
      <header className="flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Database className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Database Backups</h1>
          <p className="mt-1 text-muted-foreground">
            Back up or restore only through a separate database endpoint that exactly matches an explicit allowlist.
          </p>
        </div>
      </header>

      {message && (
        <Alert variant={message.toLowerCase().includes("failed") || message.toLowerCase().includes("unable") ? "destructive" : "default"}>
          <AlertTitle>Backup status</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Checking the database environment…</CardContent></Card>
      ) : status?.enabled && status.target ? (
        <>
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Restore endpoint matches the allowlist</AlertTitle>
            <AlertDescription>
              Environment: <strong>{status.environment}</strong> · Host: <strong>{status.target.host}</strong> · Database: <strong>{status.target.database}</strong>
              <br />
              The app's primary endpoint, production mode, and Render databases are blocked. Confirm in Neon that this is a disposable test branch; the app cannot determine whether a Neon branch is production or test.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Download a backup</CardTitle>
              <CardDescription>
                Saves a verified PostgreSQL custom-format snapshot of the allowlisted endpoint to your device.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <a href="/api/backups/development/download">
                  <Download className="mr-2 h-4 w-4" />
                  Download development backup
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Restore to development
              </CardTitle>
              <CardDescription>
                This replaces matching objects and data at the allowlisted endpoint shown above. Confirm that it is a disposable test branch before continuing. A failed restore may leave it partially changed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="database-archive">PostgreSQL custom-format backup (.dump)</Label>
                <Input
                  id="database-archive"
                  type="file"
                  accept=".dump,application/octet-stream"
                  onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
                />
                {archive && <p className="text-xs text-muted-foreground">{archive.name} · {(archive.size / (1024 * 1024)).toFixed(1)} MB</p>}
              </div>
              <label className="flex items-start gap-3 text-sm leading-5">
                <Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} />
                <span>I verified this is a disposable development/test endpoint and understand the restore will replace existing objects.</span>
              </label>
              <div className="max-w-md space-y-2">
                <Label htmlFor="restore-confirmation">Type {RESTORE_CONFIRMATION} to continue</Label>
                <Input
                  id="restore-confirmation"
                  autoComplete="off"
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                />
              </div>
              <Button variant="destructive" disabled={!canRestore} onClick={restore}>
                <HardDriveUpload className="mr-2 h-4 w-4" />
                {restoring ? "Restoring development database…" : "Restore this backup"}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : (
        <Alert variant="destructive">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Development backup tools are unavailable</AlertTitle>
          <AlertDescription>{status?.reason ?? "Could not verify a development database target."}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Automatic production backup</CardTitle>
          <CardDescription>
            Once deployed and configured, production creates one verified backup per New York calendar day after the first successful staff login. It runs in the background and sends the archive to the Google Drive backup relay.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {productionStatus?.available ? (
            <>
              <p>
                Configuration: <strong>{productionStatus.configured ? "ready" : "missing or incomplete"}</strong>
              </p>
              <p>
                Last successful backup: <strong>{productionStatus.lastSuccessDate ?? "none recorded"}</strong>
              </p>
              {productionStatus.lastAttemptAt && (
                <p className="text-muted-foreground">
                  Last attempt: {new Date(productionStatus.lastAttemptAt).toLocaleString()}
                </p>
              )}
              {productionStatus.lastError && (
                <p className="text-destructive">The latest attempt failed. Check the production service logs.</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              {productionStatus?.reason ?? "Live production status is unavailable from this workspace."}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}