# Opening-stock backfill: rollout and recovery

## Validation performed

The Render startup migration and standalone SQL migration were exercised against separate, disposable PostgreSQL 16.10 databases. The larger synthetic fixture contained 100,000 inventory rows and 1,000,000 existing stock movements: 50,000 items had prior movement history, with 20 movements per item; the rest had none. No production database or production data was used.

The test confirmed:

- Existing movement dates are set from `created_at::date`.
- Positive inventory with no movement history gets one opening movement with its current quantity, cost, creation date, and inventory reference.
- Zero, negative, and already-historied inventory do not get an opening movement.
- A second startup run does not add duplicates.
- The large fixture ended with 47,059 opening movements and no null effective dates.

On the local test environment, the large startup run took about 38 seconds. An indexed primary-key read issued during the backfill completed in about 23 ms versus 24 ms before the run, with no PostgreSQL lock wait. The earlier version that kept the date backfill inside the DDL transaction held a concurrent table read for about 28.8 seconds, so the data rewrite was moved into separate bounded transactions. Measure the target database separately if its inventory or movement volume is materially larger than this fixture.

## Safe rollout

1. Take and verify a current production backup using the existing production backup process.
2. Before deployment, compare production's inventory and stock-movement row counts with the tested 100,000 / 1,000,000 scale. If either is materially larger, repeat the test at that scale against a disposable copy before proceeding.
3. Schedule the first deployment for a low-activity period. The service does not accept traffic until startup migrations finish; the backfill is write-heavy and can slow database queries even though it no longer holds an exclusive table lock for the full rewrite.
4. Watch Render startup logs until `Render schema migrations verified` appears and the service health check succeeds. If startup aborts, do not repeatedly restart without reading the migration error.
5. After startup, check that no stock movement has a null `effective_date`; verify a few opening rows against their inventory quantity, cost, and creation date; and verify items with prior history were not given another opening row.

The movement-date rewrite commits in batches of 100,000 rows, with a brief yield between batches. A brief `SHARE` table lock is used only around the opening-row existence check and insert: history reads remain available, while concurrent movement writers wait for that short final step. The session advisory lock serializes startup migration runs across instances.

## Recovery

- If startup fails during the date backfill, the current batch rolls back; batches already committed remain. The server does not start. After correcting the cause, a normal restart or redeploy resumes the null-date backfill and is safe to repeat.
- If startup fails while validating the non-null constraint, the next run reuses the constraint if it was already created and retries validation.
- If startup fails before the opening-row insert commits, no partial opening rows remain. A retry inserts only rows whose inventory has no movement history.
- If the migration completed but the new application version must be reverted, prefer reverting the application while retaining the additive column, owner-funding table, and opening movements. Do not delete opening movements after staff have recorded later stock activity; correct the ledger forward instead.
- Keep the backup until the new service has passed its post-deploy checks. Do not restore or migrate against production as a test.