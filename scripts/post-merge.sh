#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen

# Apply hand-written SQL migrations first so drizzle-kit push has nothing to
# prompt about. Each migration is wrapped in its own BEGIN/COMMIT and is
# written to be idempotent.
if [ -n "$DATABASE_URL" ]; then
  for f in lib/db/migrations/*.sql; do
    [ -f "$f" ] || continue
    echo "Applying migration $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
fi

# Now do a non-interactive schema sync. Pipe an empty stdin so that if
# drizzle-kit ever asks an interactive question it gets EOF and aborts
# rather than hanging the post-merge step forever.
pnpm --filter @workspace/api-server exec drizzle-kit push --force </dev/null
