#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen

# Apply hand-written SQL migrations first so drizzle-kit push has nothing to
# prompt about. Each migration is wrapped in its own BEGIN/COMMIT and is
# written to be idempotent.
if [ -n "$DATABASE_URL" ]; then
  # Sort with LC_ALL=C so ordering is deterministic across locales (under
  # en_US.UTF-8, punctuation like '.' and '_' can collate unexpectedly and
  # cause a follow-up migration to run before its base file).
  uses_repair_domain=$(psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c \
    "SELECT to_regclass('public.estimate_revisions') IS NOT NULL AND to_regclass('public.repair_order_events') IS NOT NULL")
  has_legacy_estimates=$(psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c \
    "SELECT to_regclass('public.estimates') IS NOT NULL")
  has_legacy_line_items=$(psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c \
    "SELECT to_regclass('public.line_items') IS NOT NULL")
  repair_domain_reset_applied=$(psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c \
    "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'repair_order_events_append_only')")

  while IFS= read -r f; do
    [ -f "$f" ] || continue
    basename="${f##*/}"

    # These migrations belong to the retired estimates/line_items model.
    # The repair-domain migration replaced those tables with estimate_revisions
    # and estimate_revision_items; replaying the old SQL against that schema
    # fails or would recreate obsolete tables.
    if [ "$uses_repair_domain" = "t" ]; then
      case "$basename" in
        2026-05-03_estimate_approval.sql|2026-05-03_estimate_events.sql|2026-05-03_twilio_messaging.sql|2026-08-18_estimates_repair_order.sql)
          if [ "$has_legacy_estimates" = "f" ]; then
            echo "Skipping retired estimates migration $f"
            continue
          fi
          ;;
        2026-05-03_inventory_cogs.sql|2026-05-04_warranty_tracking.sql)
          if [ "$has_legacy_line_items" = "f" ]; then
            echo "Skipping retired line_items migration $f"
            continue
          fi
          ;;
      esac
    fi

    # This rebuild is intentionally destructive to the old repair schema.
    # Its append-only trigger is an application marker proving it already ran.
    if [ "$basename" = "2026-08-19_rebuild_repair_domain.sql" ] &&
      [ "$repair_domain_reset_applied" = "t" ]; then
      echo "Skipping already-applied repair-domain rebuild migration $f"
      continue
    fi

    echo "Applying migration $f"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  done < <(LC_ALL=C ls -1 lib/db/migrations/*.sql 2>/dev/null | LC_ALL=C sort)
fi

# Now do a non-interactive schema sync. Pipe an empty stdin so that if
# drizzle-kit ever asks an interactive question it gets EOF and aborts
# rather than hanging the post-merge step forever.
pnpm --filter @workspace/api-server exec drizzle-kit push --force </dev/null
