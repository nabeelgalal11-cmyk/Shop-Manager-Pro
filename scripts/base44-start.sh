#!/bin/bash
set -e

echo "=== Installing dependencies ==="
pnpm install --frozen-lockfile=false || true

echo "=== Building workspace packages ==="
cd /app/lib/db && npx tsc -b
cd /app/lib/api-zod && npx tsc -b
cd /app

echo "=== Applying database migrations ==="
if [ -n "$DATABASE_URL" ]; then
  for f in $(LC_ALL=C ls -1 lib/db/migrations/*.sql 2>/dev/null | LC_ALL=C sort); do
    echo "Applying migration $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || echo "  (skipped, may already exist)"
  done
fi

echo "=== Building and starting API server (port 3001) ==="
cd /app/artifacts/api-server
npx tsc -b
node build.mjs
export PORT=3001
node --enable-source-maps dist/index.mjs &
API_PID=$!

echo "=== Starting Vite dev server (port 5173) ==="
cd /app/artifacts/shop-os
npx vite --config vite.config.ts --host 0.0.0.0 --port 5173 &
WEB_PID=$!

wait $API_PID $WEB_PID
