# Base44 Dev Environment

## Architecture
pnpm monorepo (workspaces). Node 22, pnpm 9, TypeScript 5.9.

- **Frontend**: `artifacts/shop-os` — React + Vite dev server on port 5173 (mapped to host 3000). Proxy `/api` → API server via `VITE_API_PROXY_TARGET`.
- **API**: `artifacts/api-server` — Express 5, builds with esbuild (`build.mjs`) or runs live via `tsx watch`. Listens on port 8080.
- **DB**: `lib/db` — Drizzle ORM schema, PostgreSQL. `drizzle-kit push` applies schema at startup.
- Other packages: `915motors-mobile` (Expo RN, not web), `mockup-sandbox`, shared libs in `lib/`.

## Running
```
docker compose -f docker-compose.base44.yml up -d
```
Services: `db` (postgres:16), `setup` (pnpm install, exits), `api` (migrate + tsx watch), `web` (vite dev).

## Auth
Cookie-session auth (express-session + bcrypt). Auto-bootstraps admin user `admin` / `admin123` on first boot. Default role permissions seeded on startup.

## External Secrets (all optional — app boots without them)
- `RESEND_API_KEY` — email sending (Resend)
- `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_PORT` — fallback email
- `SQUARE_ACCESS_TOKEN` / `SQUARE_ENVIRONMENT` — Square payments
- `STRIPE_SECRET_KEY` — Stripe payments
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` — SMS
- `AI_INTEGRATIONS_OPENAI_API_KEY` — AI estimate feature
- `HOSTGATOR_STORAGE_TOKEN` / `HOSTGATOR_PUBLIC_BASE_URL` — file storage

## Key Env Vars (set via compose)
- `DATABASE_URL` — PostgreSQL connection string (local infra)
- `SESSION_SECRET` — session signing secret (dev default provided)
- `PUBLIC_BASE_URL` — base URL for public links
- `SHOP_NAME` — shop display name

## Verification
- Frontend: `curl -sf http://localhost:3000/` returns HTML
- API health: `curl -sf http://localhost:3000/api/healthz` returns `{"status":"ok"}`
- Login at `/` with `admin` / `admin123`
