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
| 2d. Sign-in (invite-only), password reset, protected pages, staff invitations | Done |
| 2e. Continuous integration (GitHub Actions) + Dependabot | Done |
| 3a. Activity database operations (save with people, status changes, office info) | Done. 171 pgTAP tests passing |
| 3b. Activity form (create and edit) | Next |
| 3c–3d. Register, search, detail and history; status changes in the UI; calendar | Planned |

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
npm run db:start                    # local Supabase (Docker Desktop must be running)
Copy-Item .env.example .env.local   # then paste the API URL and keys that db:start printed
npm run admin:create -- --email you@example.com --name "Your Name"   # prints a one-time password
npm run dev                         # http://localhost:3000
```

Sign in with the one-time password, then choose your own under **Change password**. Everyone else is invited from **Staff**; there is no public sign-up.

Locally, no email leaves your machine: invitations and password-reset emails are caught by Mailpit at http://127.0.0.1:54324.

### How sign-in works

- **Accounts:** Supabase Auth handles them with email and password. A session cookie is refreshed by `src/proxy.ts`.
- **Access checks:** every page and Server Action checks access itself (`src/lib/auth.ts`), and the database enforces the same rules with RLS. `proxy.ts` only redirects signed-out visitors; it isn't the security boundary.
- **Email links:** invite and password-reset links open `/auth/confirm`, which asks the person to press a button. Email security scanners that open links therefore can't use up the one-time token.
- **Deactivated staff** are treated as signed out, even if they still have a valid password.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate Next.js route types, then `tsc --noEmit` |
| `npm test` | Unit tests (Vitest, `src/**/*.test.ts`) |
| `npm run e2e` | Browser tests (Playwright, `e2e/`). Needs the local stack running; builds and starts the app on port 3000 unless it's already running. First time only: `npx playwright install chromium`. Or use the Edge already on Windows: `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run e2e`. The tests leave `e2e-…@example.com` users in the local database; `npm run db:reset` clears them |
| `npm run admin:create -- --email … --name "…"` | Create the first administrator for an environment (uses `SUPABASE_SECRET_KEY`) |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` after a schema change |
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

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push to `main` and every pull request. Two jobs run side by side:

| Job | Checks |
|---|---|
| Lint, types, unit tests, build | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| Database and browser tests | Starts a fresh local Supabase in the runner (all migrations from scratch), then `npm run db:test`, `npm run db:lint` and `npm run e2e` |

- **No secrets:** CI uses only the throwaway local stack inside the runner, and never touches a hosted project.
- **Failed browser tests** upload the Playwright report as a run artifact (kept 7 days).
- **Dependency updates:** [Dependabot](.github/dependabot.yml) opens grouped pull requests monthly, for npm packages and for GitHub Actions. CI checks each one before it can be merged.
- **Recommended:** in GitHub, go to **Settings → Branches** and add a rule for `main` that requires both CI jobs to pass before merging.

## Security rules

- Real secrets live only in `.env.local` (git-ignored) or the hosting provider's secret store. They are never committed.
- `SUPABASE_SECRET_KEY` bypasses Row Level Security. Use it only in server-side code, and never with a `NEXT_PUBLIC_` prefix.
- Notification secrets (Resend key, dispatch secret, live-sending flag) belong to Supabase Edge Functions, not the web app.
