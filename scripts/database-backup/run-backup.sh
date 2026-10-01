#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be provided to the backup runner}"
: "${BACKUP_UPLOAD_TOKEN:?BACKUP_UPLOAD_TOKEN must be provided to the backup runner}"
: "${BACKUP_UPLOAD_URL:?BACKUP_UPLOAD_URL must be provided to the backup runner}"

case "$BACKUP_UPLOAD_URL" in
  https://shop-manager-pro.replit.app/api/backups/upload) ;;
  *)
    echo "BACKUP_UPLOAD_URL must use the configured HTTPS backup receiver." >&2
    exit 1
    ;;
esac

backup_path="$(mktemp /tmp/915motors-production-backup.XXXXXX)"
trap 'rm -f "$backup_path"' EXIT
trap 'exit 130' HUP INT TERM

file_name="915motors-production-$(date -u +'%Y%m%dT%H%M%SZ').dump"

echo "Creating PostgreSQL custom-format backup: ${file_name}"
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$backup_path"

pg_restore --list "$backup_path" >/dev/null

size_bytes="$(wc -c < "$backup_path" | tr -d '[:space:]')"
if [ "$size_bytes" -le 0 ]; then
  echo "pg_dump produced an empty backup; refusing to upload it." >&2
  exit 1
fi
if [ "$size_bytes" -gt 2147483648 ]; then
  echo "Backup exceeds the 2 GiB receiver limit; refusing to upload it." >&2
  exit 1
fi

sha256="$(sha256sum "$backup_path" | awk '{print $1}')"
curl \
  --config - \
  --fail \
  --silent \
  --show-error \
  --retry 3 \
  --retry-delay 2 \
  --connect-timeout 30 \
  --max-time 3600 \
  --output /dev/null \
  --header "Content-Type: application/octet-stream" \
  --header "X-Backup-Filename: ${file_name}" \
  --header "X-Backup-SHA256: ${sha256}" \
  --data-binary "@${backup_path}" \
  "$BACKUP_UPLOAD_URL" <<CURL_CONFIG
header = "Authorization: Bearer ${BACKUP_UPLOAD_TOKEN}"
CURL_CONFIG

echo "Backup uploaded to Google Drive: ${file_name} (${size_bytes} bytes)"