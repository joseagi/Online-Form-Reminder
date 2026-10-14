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
| 2b. Supabase local stack, schema, RLS | Next. Needs WSL 2 + Docker Desktop |

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

## Security rules

- Real secrets live only in `.env.local` (git-ignored) or the hosting provider's secret store. They are never committed.
- `SUPABASE_SECRET_KEY` bypasses Row Level Security. Use it only in server-side code, and never with a `NEXT_PUBLIC_` prefix.
- Notification secrets (Resend key, dispatch secret, live-sending flag) belong to Supabase Edge Functions, not the web app.
