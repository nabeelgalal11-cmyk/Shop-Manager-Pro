ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS auth_sessions (
  sid text PRIMARY KEY,
  sess jsonb NOT NULL,
  expire timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expire_idx
  ON auth_sessions (expire);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
  ON auth_sessions ((sess->>'userId'));

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  ip text PRIMARY KEY,
  attempt_count integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_expires_at_idx
  ON auth_login_attempts (expires_at);
