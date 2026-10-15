# Office Activities & Reminders

Internal web app for an office of up to about 20 staff:

- Record meetings, deadlines, appointments and other activities.
- Send a shared office summary every Sunday.
- Send individual day-before email reminders. WhatsApp comes later.

- **Architecture, schema, costs and roadmap:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Stack:** Next.js 16 (App Router, TypeScript) · Supabase (Postgres, Auth, Cron, Edge Functions) · Resend

## Status

| Phase | State |
|---|---|
| 1. Environment & requirements | Done. Architecture approved 2026-10-14 |
| 2a. Repo + Next.js scaffold | Done |
| 2b. Supabase local stack, schema, audit, deny-by-default RLS | Done |
| 2c. RLS access policies + permission tests | Done. 128 pgTAP tests passing |
| 2d. Sign-in (invite-only), session handling, protected pages | Next |

## Prerequisites (Windows)

| Tool | Version | Install |
|---|---|---|
| Node.js | 24.x LTS (see `.nvmrc`) | `nvm install 24.21.0` then `nvm use 24.21.0` |
| Git | any recent | already installed |
| WSL 2 | n/a | `wsl --install --no-distribution` (admin PowerShell, then reboot) |
| Docker Desktop | current | `winget install --id Docker.DockerDesktop -e` (from Phase 2b) |

`.npmrc` sets `engine-strict=true`, so `npm install` refuses to run on the wrong Node version.

## Getting started

```powershell
npm install
Copy-Item .env.example .env.local   # fill in values once Supabase is set up (Phase 2b)
npm run dev                         # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next.js route types, then `tsc --noEmit` |
| `npm run db:start` | Start the local Supabase stack (Docker Desktop must be running). Prints the local URL and keys |
| `npm run db:stop` | Stop the local stack |
| `npm run db:reset` | Rebuild the local database from `supabase/migrations/` |
| `npm run db:test` | Run the pgTAP database tests in `supabase/tests/database/` |
| `npm run db:lint` | Check database functions for errors |

The local stack leaves out Supabase Studio and the Edge Functions runtime until they're needed (Phase 4). The keys `db:start` prints are the standard local-development keys, not production secrets.

### Database changes

Every schema change is a new SQL file in `supabase/migrations/`; applied migrations are never edited. After adding one, run `npm run db:reset` and `npm run db:test`.

### Troubleshooting: Docker image downloads fail

If `db:start` can't download images from `public.ecr.aws` or `ghcr.io`, tell the CLI to use Docker Hub for that session:

```powershell
$env:SUPABASE_INTERNAL_IMAGE_REGISTRY = 'docker.io'
npm run db:start
```

## Security rules

- Real secrets live only in `.env.local` (git-ignored) or the hosting provider's secret store. They are never committed.
- `SUPABASE_SECRET_KEY` bypasses Row Level Security. Use it only in server-side code, and never with a `NEXT_PUBLIC_` prefix.
- Notification secrets (Resend key, dispatch secret, live-sending flag) belong to Supabase Edge Functions, not the web app.
