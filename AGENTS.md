# Base44 Dev Environment

## Architecture
- **Monorepo**: pnpm workspaces with `node:22-slim` base image
- **Frontend**: `artifacts/shop-os` — Vite + React 19 + Tailwind v4 + wouter
- **Backend**: `artifacts/api-server` — Express 5 + Drizzle ORM + PostgreSQL
- **Shared libs**: `lib/db` (Drizzle schema, CJS), `lib/api-zod` (Zod schemas, CJS), `lib/api-client-react` (React Query hooks, ESM)

## Running the app
```bash
docker compose -f docker-compose.base44.yml up -d
```
- Vite dev server on **port 3000** (live reload, serves frontend)
- Express API server on **port 3001** (proxied via Vite's `/api` proxy)
- Both run in a single container (`app` service)

## Key setup details
- `lib/db` and `lib/api-zod` are CommonJS packages that must be built with `tsc -b` before the API server can start
- The API server is bundled with esbuild (`node build.mjs`) — workspace packages are bundled in
- pnpm v11 requires `dangerously-allow-all-builds=true` in `/root/.npmrc` (set in Dockerfile)
- `verify-deps-before-run=false` is also needed to prevent pnpm from re-running install before `pnpm run` commands
- The startup script (`scripts/base44-start.sh`) handles: install → build workspace packages → apply SQL migrations → start API + Vite
- Database migrations in `lib/db/migrations/*.sql` are idempotent and applied on every boot
- The `PORT` env var from secrets is overridden to 3001 in the startup script for the dev environment

## Vite proxy
The Vite dev server proxies `/api` to `http://localhost:3001` (configured in `artifacts/shop-os/vite.config.ts`). This is a single-origin setup — the frontend and API share port 3000 from the browser's perspective, which is important for session cookies (SameSite=lax).

## Default admin
The `bootstrapAdmin` function creates an `admin`/`admin123` user only if no users exist. If the database already has data (e.g., from production), use existing credentials.

## Known issues
- `artifacts/api-server/drizzle.config.ts` was corrupted (content duplicated 4x) — fixed to single copy
- Root `drizzle.config.ts` is empty (0 bytes) — the working config is at `lib/db/drizzle.config.ts`
- `drizzle-kit push` in the startup script may fail if `drizzle-orm` isn't resolvable via `npx` — this is non-fatal since SQL migrations handle schema creation
