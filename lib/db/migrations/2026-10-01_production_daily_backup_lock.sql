ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS production_backup_success_date date,
  ADD COLUMN IF NOT EXISTS production_backup_lock_token text,
  ADD COLUMN IF NOT EXISTS production_backup_lock_date date,
  ADD COLUMN IF NOT EXISTS production_backup_lock_until timestamptz,
  ADD COLUMN IF NOT EXISTS production_backup_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_backup_last_error text;