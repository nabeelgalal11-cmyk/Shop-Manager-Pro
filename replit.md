# Workspace

## Overview

ShopOS - A comprehensive auto repair shop management system. Full-stack application with a React + Vite frontend and Express API server backed by PostgreSQL.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Recharts

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   └── shop-os/            # React + Vite frontend (ShopOS)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## ShopOS Modules

1. **Dashboard** - Revenue stats, open jobs, appointments, activity feed, revenue chart
2. **Customers** - Customer database with billing statements
3. **Vehicles** - Vehicle database with service history
4. **Estimates** - Create and send repair estimates, convert to invoices
5. **Invoices** - Invoice management, track unpaid invoices
6. **Repair Orders** - Job cards with status tracking, technician assignment
7. **Inventory** - Parts inventory with low-stock alerts
8. **Inspections** - Digital inspection forms with checklists
9. **Appointments** - Shop scheduling calendar
10. **Payments** - Payment recording and tracking
11. **Employees** - Employee management with clock in/out
12. **Time Entries** - Technician time tracking
13. **Expenses** - Shop expense tracking
14. **Reminders** - Service reminder management with auto-generation on repair order completion
15. **Customer Categories** - Pricing tiers (labor rate + parts markup) assigned to customers
16. **Used Cars** - Used/resale vehicle inventory with purchase/selling prices and profit tracking
17. **Reports** - Analytics dashboard: revenue KPIs, monthly trends, revenue-by-category charts, top customers, expense breakdown, used car sales summary
18. **Purchases** - Supplier purchase orders with invoice file upload (PDF/image via GCS Object Storage), line items linked to inventory parts or used cars, status tracking (pending/received/partial/returned)

## Database Schema

Tables: customer_categories, customers (with categoryId FK), vehicles, employees, repair_orders, estimates, invoices, line_items, payments, inventory, inspections, appointments, time_entries, expenses, reminders, used_cars, purchases, purchase_line_items

## API Routes

All routes under `/api/`:
- `/customers`, `/vehicles`, `/employees`
- `/repair-orders`, `/estimates`, `/invoices`, `/payments`
- `/inventory`, `/inspections`, `/appointments`
- `/time-entries`, `/expenses`, `/reminders`
- `/customer-categories` — CRUD for pricing tier categories
- `/used-cars` — CRUD for used/resale vehicle inventory
- `/reports/overview`, `/reports/revenue-by-category`, `/reports/monthly-revenue`, `/reports/top-customers`, `/reports/expenses-by-category`, `/reports/used-cars`
- `/dashboard/summary`, `/dashboard/recent-activity`, `/dashboard/revenue-chart`, `/dashboard/job-status-breakdown`, `/dashboard/top-services`
- `/purchases` — CRUD for supplier purchase orders with file metadata
- `/purchases/:id/invoice` — PATCH to attach invoice file (objectPath from GCS upload)
- `/storage/uploads/request-url` — POST to get presigned GCS upload URL
- `/storage/objects/*` — GET to serve private uploaded files
- `/storage/public-objects/*` — GET to serve public assets

## Object Storage

GCS bucket provisioned via Replit Object Storage. Upload flow: POST `/api/storage/uploads/request-url` → PUT file directly to presigned GCS URL → PATCH `/api/purchases/:id/invoice` with returned `objectPath`. Files served via `/api/storage/objects/...`. Client uses `useUpload` hook from `@workspace/object-storage-web`.

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push schema changes to database
