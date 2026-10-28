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
| 3b. Activity form (create and edit), basic detail page | Done |
| 3c. Register: list, search, filters, detail with change history | Done |
| 3d. Complete / cancel / reopen in the UI; month and week calendar | Done. **Phase 3 complete** |
| 4a. Summary content, weekly planner and notification queue (database) | Done. 219 pgTAP tests passing |
| 4b. Dispatcher Edge Function (template, log-only provider, test-mode gate) and Supabase Cron schedule | Done |
| 4c. Admin: summary settings, recipients, preview, test send, notification log | Done. 237 pgTAP tests passing. **Phase 4 complete** |
| 5a. Day-before reminders: planning, sync with activity changes, send-time checks, template (logged, not emailed) | Done. 268 pgTAP tests passing |
| 5b. Resend email provider: idempotency keys, error handling, no-duplicate crash test | Done. 157 unit, 20 integration tests passing |
| 5c. Resend delivery webhooks (signed): delivered, bounced, complained | Done. 286 pgTAP, 169 unit, 25 integration, 24 browser tests passing |
| 5d. Admin: retry and cancel, reminder settings, reminders on the activity page, problem badge | Done. 310 pgTAP, 179 unit, 25 integration, 28 browser tests passing. **Phase 5 complete** (the failure alert email moved to Phase 6) |
| 6a. Permission hardening: privilege allowlist for every function, table and sequence; new objects start closed; every Server Action checks the caller | Done. 320 pgTAP, 191 unit, 25 integration, 28 browser tests passing |
| 6b. Time zones across daylight-saving changes | Planned |
| 6c. Outage and recovery: scheduler backlog, provider outage, each message sent once | Planned |
| 6d. Failure alert email to administrators (rate-limited) | Planned |
| 6e. Acceptance evidence for every §8 criterion (`docs/ACCEPTANCE.md`) | Planned |

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
| `npm test` | Unit tests (Vitest: `src/**/*.test.ts` and the Edge Functions' pure modules) |
| `npm run test:integration` | Tests against the running local stack: the `dispatch-notifications`, `summary-preview` and `resend-webhook` Edge Functions (`tests/integration/`). The Resend tests run the dispatcher directly with Deno (port 8000) against a fake Resend, so no email is sent. Needs `npm run dispatch:setup` once |
| `npm run functions:check` | Type-check the Edge Functions with Deno |
| `npm run dispatch:setup` | Local only: give the dispatcher a secret (`supabase/functions/.env`) and tell the database where to call it, so Supabase Cron runs it every 5 minutes. Also adds a placeholder `RESEND_WEBHOOK_SECRET` if there is none |
| `npm run webhook:forward` | Local only: pass Resend's delivery reports from a tunnel to the `resend-webhook` function, and nothing else (see *Delivery reports locally*) |
| `npm run e2e` | Browser tests (Playwright, `e2e/`). Needs the local stack running; builds and starts the app on port 3000 unless it's already running. First time only: `npx playwright install chromium`. Or use the Edge already on Windows: `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run e2e`. The tests leave `e2e-…@example.com` users in the local database; `npm run db:reset` clears them |
| `npm run admin:create -- --email … --name "…"` | Create the first administrator for an environment (uses `SUPABASE_SECRET_KEY`) |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` after a schema change |
| `npm run db:start` | Start the local Supabase stack (Docker Desktop must be running). Prints the local URL and keys |
| `npm run db:stop` | Stop the local stack |
| `npm run db:migrate` | Apply new migrations to the local database, **keeping existing data** (accounts, activities) |
| `npm run db:reset` | Rebuild the local database from scratch. **Erases all local data, including accounts**; afterwards run `npm run admin:create` again |
| `npm run db:test` | Run the pgTAP database tests in `supabase/tests/database/` |
| `npm run db:lint` | Check database functions for errors |

The local stack leaves out Supabase Studio. The keys `db:start` prints are the standard local-development keys, not production secrets.

### Scheduled notifications (local)

- **Every 5 minutes:** Supabase Cron plans the weekly summaries and reminders in the database, then calls the `dispatch-notifications` Edge Function with a shared secret. This keeps working whether or not anyone has the website open.
- **Reminders** go to each person listed on an activity who has email reminders on:
  - **Timed activity:** 24 hours before the start.
  - **All-day activity:** at 09:00 (office time) the day before.
  - **Activity added late:** right away if at least 2 hours remain, otherwise not at all.
  - Each person's reminder follows the activity as it changes: a new time, someone removed, cancelled or completed, reminders turned off. It is checked again just before sending.
  - Changing only the details changes nothing, because the message is written when it's sent.
  - The timings are on the Settings page (in the database: `reminder_lead`, `date_only_reminder_time`, `reminder_min_notice`). Changes apply within 5 minutes to reminders not yet sent.
  - People who can edit an activity (its creator, its responsible person, administrators) see its reminders on the activity page.
- **Email goes through Resend** once the function has a key (see *Sending real email locally* below). Without one, every message is only logged. Real recipients need **both** `notification_mode = live` (set by an admin) **and** `NOTIFICATIONS_LIVE=true` on the server (production only).
- **In test mode** messages go only to the test address, marked [TEST]. Without a test address they are only logged. **Send test to me** goes to the administrator who asked.
- **Addresses on reserved test domains** (`example.com`, `.test`, `.example`, `.invalid`, `localhost`) are never passed to Resend; those messages are only logged. Test accounts such as `admin@office.test` and the `e2e-…@example.com` users therefore never cause bounces.
- **No duplicates:** each message is sent with its job key as Resend's `Idempotency-Key` and with the content frozen at the first attempt. A retry after a crash returns Resend's first answer instead of sending again. Temporary failures (network, timeouts, 429, 5xx) are retried with growing waits, honouring `Retry-After`; rejections (invalid address, bad key) are marked failed.
- **One-time setup:** run `npm run dispatch:setup`, then restart the stack (`npm run db:stop`, then `npm run db:start`). The restart lets the function read its new secret.
- **To see what happened:** open **Admin → Notifications** (below). Underneath, it reads `public.notification_jobs` (each message, its rendered content and status) and `public.notification_logs` (every attempt, plus `run.started` / `run.finished` heartbeats).
- **After adding a new Edge Function** (a new folder in `supabase/functions/`), restart the stack. The local Edge Runtime only finds functions when it starts; until then, calls return 404 "Function not found". Your data is kept.
- **After changing a function's code**, restart the Edge Runtime (`docker restart supabase_edge_runtime_office-reminders`). Edits aren't reliably picked up while it runs.
- **After changing `supabase/functions/.env`**, restart the whole stack (`npm run db:stop`, then `npm run db:start`). The secrets are handed to the Edge Runtime only when the stack starts, so `docker restart` keeps the old ones.

### Sending real email locally (Resend)

1. In Resend, create an API key with **Sending access** (resend.com/api-keys).
2. Add two lines to `supabase/functions/.env` (git-ignored; never commit the key):
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM_ADDRESS=onboarding@resend.dev
   ```
   Until a domain is verified in Resend, `onboarding@resend.dev` can deliver **only to the address you signed up to Resend with**.
3. Restart the stack so the function reads them: `npm run db:stop`, then `npm run db:start`.
4. In **Admin → Settings**, choose **test** mode and set the **test address** to your Resend sign-up address.

Everything due then goes to that inbox, marked [TEST], including reminders for the e2e tests' activities, so turn the test address off (or the mode to **off**) when you don't want them. The free plan allows 100 emails a day. To try **Send test to me**, sign in as an administrator whose own address is your Resend sign-up address; `admin@office.test` is a reserved test address and is only logged.

### Delivery reports locally (Resend webhooks)

Resend reports what happened to each message (delivered, delayed, bounced, marked as spam, failed, suppressed) by calling the `resend-webhook` Edge Function. Each report is signed, and the function refuses any it can't verify with `RESEND_WEBHOOK_SECRET`. Resend can't reach your computer directly, so locally a tunnel is needed. The tunnel only leads to a small forwarder that passes on webhook calls and nothing else; a tunnel to port 54321 would publish the whole local Supabase API, whose keys are the well-known local defaults.

1. Install Cloudflare's tunnel tool once (no account needed): `winget install --id Cloudflare.cloudflared`
2. In one terminal: `npm run webhook:forward`
3. In another: `cloudflared tunnel --url http://127.0.0.1:54399`. It prints an `https://….trycloudflare.com` address, which changes each time you start it.
4. In Resend, go to **Webhooks → Add webhook**. Set the URL to `https://….trycloudflare.com/resend-webhook` and choose the events `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` and `email.suppressed`.
5. Copy the webhook's **signing secret** (`whsec_…`) over the placeholder `RESEND_WEBHOOK_SECRET` in `supabase/functions/.env`, then restart the stack (`npm run db:stop`, then `npm run db:start`).
6. Send something (for example a reminder in test mode). Within a minute the forwarder prints the report, and **Admin → Notifications** shows **Delivered**. To see a bounce, set the test address to `bounced@resend.dev`.

When you're done, stop both, and delete or disable the webhook in Resend: it will keep retrying a dead address for about a day, then disable itself.

### Admin screens

Administrators see an **Admin** link in the header. Staff who open these addresses get "page not found".

| Screen | What it's for |
|---|---|
| **Settings** (`/admin/settings`) | Office name, weekly summary on/off, Sunday send time, how late it may still go out, send-if-empty, reminder timings, notification mode (off / test / live), test address, sender name, reply-to |
| **Weekly summary** (`/admin/summary`) | When the next summary goes out and to how many people, a preview of any week (the real template, via the `summary-preview` Edge Function), who receives it (staff and shared mailboxes), and **Send test to me** |
| **Notifications** (`/admin/notifications`) | Messages with their status: weekly summaries, test messages and reminders (named after their activity). **Waiting** lists the next due first; the other filters list the latest due first. **Not delivered** lists messages Resend reported as bounced, marked as spam, failed or suppressed. Up to 100 at a time. Also the scheduler's last run (a warning if it's more than 15 minutes old), and per-message details: content as sent, every attempt, a link to the reminder's activity, and **Cancel** / **Send again** / **Undo cancel** |
| **Staff** (`/admin/staff`) | Invite, change role, deactivate |

- **Send test to me** queues one test-marked summary of the coming week to your own address and asks the dispatcher to run straight away, in test mode too. When notifications are off, the button says so and sends nothing. You can send up to 5 an hour.
- **Delivery** shows what Resend reported: "Not confirmed" until a report arrives, then "Delivered", "Delayed", "Bounced", "Marked as spam", "Failed" or "Suppressed". Problems are shown in red, and the **Not delivered** filter lists them. A message's details show each report, with the receiving server's reason for a bounce. A message that was only logged shows as "Logged only (test)".
- **Cancel, send again, undo:** on a message's details page.
  - **Cancel this message** stops a message that is still waiting. The planner never brings it back. If the activity later moves to a new time, that new time gets its own reminder.
  - **Send again** retries a failed message, and **Undo cancel** reverses an administrator's cancel. Both work only before the message's deadline (the activity's start; for a summary, its late cutoff).
  - A message sent again keeps its key and content, so Resend won't deliver it twice if an earlier attempt did get through within the last 24 hours. For "unclear whether it was sent", check Resend's email log first; the page warns about this.
  - Each action is recorded in the message's history, with who did it.
- **Red badge:** the number next to **Admin** (in the header) and **Notifications** counts messages that failed or were reported as not delivered in the last 7 days.

### Database changes

Every schema change is a new SQL file in `supabase/migrations/`; applied migrations are never edited. After adding one, run `npm run db:migrate` (keeps your local data) and `npm run db:test`. CI always rebuilds from scratch, so every migration is also tested that way on each push.

- **New objects start closed.** Since stage 6a, a new table, function or sequence gives signed-in users and anonymous visitors no rights. If signed-in users need one, grant it in the same migration. A function they call must check the caller itself (`is_admin()`, `can_edit_activity()`, …).
- **Then add it to the allowlist.** [`14_privileges.test.sql`](supabase/tests/database/14_privileges.test.sql) lists exactly what the API roles may use, and fails until a new grant is added there on purpose.
- **Lint for enums.** `npm run db:lint` warns when PL/pgSQL assigns text to an enum without a cast (`'sent'::public.job_status`). CI treats warnings as failures.
- **Server Actions** must call `requireUser()` or `requireAdmin()` first. [`src/app/server-actions.test.ts`](src/app/server-actions.test.ts) checks every one; the four meant for signed-out visitors (sign in, sign out, reset request, email link) are listed there.

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
| Lint, types, unit tests, build | `npm run lint`, `npm run typecheck`, `npm run functions:check`, `npm test`, `npm run build` |
| Database and browser tests | Starts a fresh local Supabase in the runner (all migrations from scratch), then `npm run db:test`, `npm run db:lint`, `npm run dispatch:setup`, `npm run test:integration` and `npm run e2e` |

- **No secrets:** CI uses only the throwaway local stack inside the runner, and never touches a hosted project.
- **Failed browser tests** upload the Playwright report as a run artifact (kept 7 days).
- **Dependency updates:** [Dependabot](.github/dependabot.yml) opens grouped pull requests monthly, for npm packages and for GitHub Actions. CI checks each one before it can be merged.
- **Recommended:** in GitHub, go to **Settings → Branches** and add a rule for `main` that requires both CI jobs to pass before merging.

## Security rules

- Real secrets live only in `.env.local` (git-ignored) or the hosting provider's secret store. They are never committed.
- `SUPABASE_SECRET_KEY` bypasses Row Level Security. Use it only in server-side code, and never with a `NEXT_PUBLIC_` prefix.
- Notification secrets (Resend key, dispatch secret, live-sending flag) belong to Supabase Edge Functions, not the web app.
