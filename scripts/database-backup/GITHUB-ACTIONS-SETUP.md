# Daily backup with GitHub Actions

The scheduled workflow runs `pg_dump` in the official PostgreSQL 16 container,
validates the archive, calculates its SHA-256 checksum, and sends it to the
existing token-protected Replit receiver for upload to Google Drive.

## Security requirements

- Keep the GitHub repository **private** and grant write access only to people
  trusted to manage the backup workflow.
- The workflow checks repository visibility before checkout or secret use and
  exits if the repository is public.
- The production database URL is supplied to GitHub Actions as a repository
  secret at run time. It is not stored in the workflow or printed by the script.
  GitHub's runner must still handle the URL while making the backup.
- Do not add a `pull_request` trigger to this workflow. A workflow editor could
  change the job code, so workflow editors must be trusted with the database
  credential.
- The workflow has read-only repository permissions and only passes secrets to
  the backup step.

## Add the repository secrets

In the private repository, open **Settings → Secrets and variables → Actions**
and add these repository secrets:

1. `PRODUCTION_DATABASE_URL` — the **external** connection URL for the live
   PostgreSQL database on Render. GitHub-hosted runners cannot use Render's
   private/internal database hostname. Do not use `NEON_DATABASE_URL` or the
   Replit database URL.
2. `BACKUP_UPLOAD_TOKEN` — the same token configured on the Replit backup upload
   receiver.

Enter both values directly in GitHub's secret form. Do not commit them, put them
in a workflow file, or paste them into chat.

## Run and check the first backup

Push this workflow to the repository's **default branch**, then open
**Actions → Daily production database backup → Run workflow** for a manual test.
The workflow runs daily at 06:17 UTC. Scheduled runs may be delayed by GitHub;
the manual run is useful for confirming setup.

The job logs the generated filename and byte count, but not the database URL or
upload token. Confirm the run succeeds and the dated backup appears in the
configured Google Drive folder. The Replit receiver must be published and
configured with `BACKUP_UPLOAD_TOKEN` before the first run.

GitHub Free currently includes 2,000 standard runner minutes per month for a
private repository. If included minutes are exhausted and no payment method is
configured, GitHub blocks additional usage rather than charging for it.