# Office Activity & Reminder System: Architecture and Plan

**Status:** v1.0 APPROVED 2026-10-14. All §11 defaults accepted. The sending domain (§11 item 9) is still needed before Phase 7.
**History:** v0.1 draft 2026-10-13 (Phase 1) → v1.0 approved 2026-10-14.

---

## 1. Summary

A small Next.js web app where staff record meetings, deadlines and other activities. Supabase Postgres stores everything and enforces access rules with row-level security (RLS). All notification work runs **inside Supabase**:

- `pg_cron` ticks every 5 minutes.
- A SQL "planner" decides which emails should exist.
- An Edge Function "dispatcher" sends due emails through Resend, using idempotency keys.

The website can be closed, and the web host can even be down, without affecting reminders. WhatsApp is designed for now but not built until Phase 8.

```
 Staff / admin browser
        │ HTTPS (Supabase session cookie)
        ▼
 Next.js 16 app (web host) ── supabase-js with the USER's session (RLS applies) ──┐
   • activity form, register, calendar, admin screens                             │
   • Zod validation on client and server                                          ▼
   • admin-only server code: invite users (secret key, server-side only)   Supabase Postgres
                                                                            • tables + RLS
                                                                            • triggers: audit, reminder sync
                                                                            • plan_notifications()
                                                                            • claim / complete RPCs
                                                                            • pg_cron every 5 min ──┐
                                                                                                    │ pg_net POST
                                                                                                    ▼ (x-dispatch-secret)
                                                            Edge Function: dispatch-notifications
                                                              • claim due jobs (lease, SKIP LOCKED)
                                                              • re-validate → render → send
                                                              • provider: resend | log | (whatsapp later)
                                                                      │ HTTPS + Idempotency-Key
                                                                      ▼
                                                                   Resend ──► recipients' mailboxes
                                                                      │ signed webhooks (svix-*)
                                                                      ▼
                                                            Edge Function: resend-webhook → delivery status
```

---

## 2. Requirements baseline and assumptions

| Item | Baseline |
|---|---|
| Users | 1–20 staff logins; external collaborators have no login |
| Volume | Estimated ≤ 20 activities/week. About 300 notification emails/month (see §10) |
| Timezone | Office timezone `Africa/Lagos` (UTC+1, no DST). The design still handles DST correctly, so another office timezone works |
| Mail clients | Mixed tools, so notifications are standard HTML and plain-text emails that any mailbox can receive. No dependency on Google or Microsoft APIs |
| Channels | Email in the first release. WhatsApp in Phase 8, only after email passes acceptance tests |
| Records | Activities are never hard-deleted. They are cancelled or completed, and history stays available |

Assumptions that need your confirmation are listed in §11.

---

## 3. Architecture decisions

### AD-01 Web app: Next.js 16 (App Router) + TypeScript on Node 24 LTS
- **Why:** The brief names this stack. It provides server actions and route handlers, so no separate API server is needed. Current npm versions: `next` 16.4.0, `react` 19.3.0.
- **Note:** The local machine runs Node 20, which reached end-of-life in 2026. We standardise on Node 24 LTS (§13).
- **Resolved (Phase 2a):** The latest `typescript` on npm is 7.0.2, but the Next.js 16.4 template pins `typescript@^5`. We stay on 5.x until Next.js supports 7.
- **Accepted risk (Phase 2a):** `npm audit` reports 0 vulnerabilities in production dependencies. It does report 5 "high" findings in the **dev-only** lint chain (`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`, a denial-of-service via crafted glob patterns). This code never ships, and npm's only "fix" is a downgrade to the Next.js 14 lint config. Re-check when `eslint-config-next` updates.

### AD-02 Database and auth: Supabase Postgres + Supabase Auth, invite-only
- Public sign-up is disabled. Admins invite staff. Leavers are **deactivated** (profile `is_active = false` plus an Auth ban), never deleted, so history stays intact.
- We use Supabase's **new API keys** from the start:
  - Publishable key (`sb_publishable_…`): browser-safe, RLS applies.
  - Secret key (`sb_secret_…`): bypasses RLS, server-only, and rejected in browsers.
- Supabase is deprecating the legacy `anon` and `service_role` JWT keys by the end of 2026.
- **Implemented in stage 2d:**
  - Email and password sign-in, with sessions in cookies refreshed by `src/proxy.ts` using `getClaims()`.
  - A per-request access check in `src/lib/auth.ts`. Deactivated profiles count as signed out.
  - Invite and reset links that land on `/auth/confirm` and need a button press, so email scanners can't use up the one-time token.
  - Password policy: at least 10 characters, with letters and digits.
  - The first admin is created with `npm run admin:create`.
- **For production (Phase 7):** copy `supabase/templates/*.html` into the hosted project's email templates, set its Site URL to the production address, turn off public sign-up, and apply the same password policy.
- **Not done yet:** staff invitations aren't yet recorded as a semantic audit event (the new profile row is audited). This comes with the Phase 3 admin screens.
- Auth emails (invites, password resets) go through **Resend as custom SMTP**. Supabase's built-in SMTP sends only to project team addresses and is limited to 2 messages/hour.

### AD-03 Data access: SQL migrations + supabase-js + Postgres functions (no Prisma)

| Option | RLS | Multi-row transactions | Reuse in Edge Functions (Deno) | RLS policies, triggers, cron in migrations | Verdict |
|---|---|---|---|---|---|
| **supabase-js + Supabase CLI SQL migrations + RPC functions** | Native: requests carry the user's JWT | Via SQL functions (`save_activity(...)`) | Yes, same client | Yes, plain SQL | **Chosen** |
| Prisma | Bypassed: connects as a privileged role unless JWT claims are set by hand in every transaction | Yes | Poor | Needs raw SQL anyway | Not chosen |
| Drizzle | Same privileged-connection problem. Workable with extra plumbing | Yes | Possible | Partial | Reasonable later alternative |

- Type safety comes from `supabase gen types typescript`. Zod 4 schemas are shared by the form and the server.
- Any write that touches several rows, such as an activity plus its recipients, goes through a `security invoker` SQL function. That keeps it atomic and still subject to RLS.

### AD-04 Scheduler: Supabase Cron → SQL planner → Edge Function dispatcher
- One `pg_cron` job runs every 5 minutes:
  - `select plan_notifications();` runs in SQL and creates, updates or cancels jobs.
  - Then `net.http_post(...)` calls the `dispatch-notifications` Edge Function. The URL and secret are read from Supabase Vault, which is the pattern Supabase documents.
- **The Sunday send time is not encoded in a cron expression.** Cron just ticks, and the planner computes "Sunday at the configured time in Africa/Lagos". Admin changes therefore take effect immediately and stay timezone-safe.
- **Rejected:** Vercel Cron, because Hobby is non-commercial only and it would tie reminders to the web host. A long-running worker, because it means another server to run and pay for.
- **Edge Function limits we design around:** 2 s CPU per request (async I/O excluded), 150 s wall clock on Free and 400 s on paid plans, 256 MB memory, and outbound ports 25/587 blocked. That last limit is why we use Resend's HTTPS API, not SMTP. Each run processes a bounded batch (default 25 jobs), and the next tick continues.
- The dispatcher runs with `verify_jwt = false` and checks a dedicated `x-dispatch-secret` header with a constant-time comparison. The publishable key is public, so it must not be what authorises dispatch.

### AD-05 Queue: a transactional `notification_jobs` table (the queue is the database)
- One job = one message to one person on one channel for one occurrence.
- Jobs are claimed with `FOR UPDATE SKIP LOCKED` and a 5-minute lease, so overlapping runs never double-claim.
- **Considered:** Supabase Queues (pgmq). It isn't needed at this volume, and a plain table doubles as the queryable delivery history the admin screens need.

### AD-06 Email provider: Resend over its HTTPS API, behind a provider interface
- Every send carries `Idempotency-Key = job.dedupe_key`. Resend keeps keys for 24 h, and a retry with the same key and payload returns the original result without sending again.
- Delivery confirmation comes from signed webhooks (`email.delivered`, `email.bounced`, …), stored separately from "accepted by provider".

### AD-07 Time handling: store wall-clock intent, derive instants in the database
- Activities store `activity_date`, an optional `start_time`/`end_time`, and an IANA `timezone`.
- A trigger derives `starts_at`/`ends_at` (`timestamptz`). All window arithmetic happens in SQL with `AT TIME ZONE` and half-open intervals `[start, end)`.
- Display uses `Intl.DateTimeFormat` with `timeZone: 'Africa/Lagos'`.

### AD-08 Test mode needs two independent switches to send real email (§7.8)

### AD-09 Hosting: Vercel Pro recommended
- Vercel's Hobby plan is "non-commercial, personal use only", and an office tool is commercial use. Pro costs $20 per developer seat per month.
- Because notifications don't depend on the web host, a cheaper host can't break reminders. A Netlify alternative is in §10.

### AD-10 Email templates live only in the Edge Function
- The admin "preview summary" calls the function in render-only mode and shows the HTML in a sandboxed iframe. There is one template source of truth and no drift between preview and the real email.
- All user-supplied text is HTML-escaped. Meeting links must be `http(s)`.

### AD-11 Built for deterministic testing
- Every time-dependent SQL function takes `p_now timestamptz default now()`.
- The dispatcher's provider can be swapped (a `log` provider makes no network calls).
- This lets tests simulate whole weeks, outages and crashes without waiting for real time or sending real email.

---

## 4. Data model

Eight tables: the seven in the brief, plus **`contacts`**. The addition is justified because:

1. External collaborators recur, so storing them once avoids retyping and inconsistent addresses.
2. WhatsApp consent (Phase 8) belongs to a **person**, not to an activity, so it needs a per-person record.

This is a design sketch. The final migrations are written and tested in Phase 2.

```sql
-- Extensions: pg_cron, pg_net, supabase_vault, citext (in schema "extensions")

create type public.app_role             as enum ('admin', 'staff');
create type public.activity_status      as enum ('scheduled', 'completed', 'cancelled');
create type public.activity_visibility  as enum ('office', 'restricted');
create type public.recipient_role       as enum ('responsible', 'collaborator', 'notify_only');
create type public.notification_channel as enum ('email', 'whatsapp');
create type public.notification_kind    as enum ('day_before_reminder', 'weekly_summary', 'test');
create type public.job_status           as enum ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped');
create type public.delivery_status      as enum ('unknown', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'suppressed');
create type public.notification_mode    as enum ('off', 'test', 'live');

-- Staff logins (1:1 with auth.users). No ON DELETE CASCADE: staff are deactivated, never deleted.
create table public.profiles (
  id                      uuid primary key references auth.users (id),
  full_name               text not null check (char_length(btrim(full_name)) between 1 and 120),
  email                   extensions.citext not null unique,
  phone_e164              text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  role                    public.app_role not null default 'staff',
  is_active               boolean not null default true,
  receives_weekly_summary boolean not null default true,
  whatsapp_opt_in_at      timestamptz,             -- Phase 8: consent evidence
  whatsapp_opt_out_at     timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- External people (no login). Reusable across activities.
create table public.contacts (
  id                      uuid primary key default gen_random_uuid(),
  full_name               text not null check (char_length(btrim(full_name)) between 1 and 120),
  organisation            text,
  email                   extensions.citext,
  phone_e164              text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  receives_weekly_summary boolean not null default false,   -- e.g. a shared group mailbox
  whatsapp_opt_in_at      timestamptz,
  whatsapp_opt_out_at     timestamptz,
  is_active               boolean not null default true,
  created_by              uuid not null references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (email is not null or phone_e164 is not null)
);
create unique index contacts_email_uniq on public.contacts (email) where email is not null;

create table public.activities (
  id                        uuid primary key default gen_random_uuid(),
  title                     text not null check (char_length(btrim(title)) between 1 and 200),
  description               text check (char_length(description) <= 5000),
  timezone                  text not null default 'Africa/Lagos',   -- trigger validates against pg_timezone_names
  activity_date             date not null,
  start_time                time,                                   -- null => date-only activity
  end_time                  time,
  starts_at                 timestamptz not null,                   -- derived by trigger; clients cannot set it
  ends_at                   timestamptz,                            -- derived by trigger
  location                  text check (char_length(location) <= 300),
  meeting_url               text check (meeting_url ~* '^https?://'),
  contact_name              text,
  contact_phone             text,
  contact_email             extensions.citext,
  preparation_notes         text check (char_length(preparation_notes) <= 5000),
  status                    public.activity_status not null default 'scheduled',
  visibility                public.activity_visibility not null default 'office',
  reminders_enabled         boolean not null default true,
  include_in_weekly_summary boolean not null default true,
  status_reason             text,                                   -- e.g. cancellation reason
  status_changed_at         timestamptz,
  status_changed_by         uuid references public.profiles (id),
  version                   integer not null default 1,             -- optimistic concurrency on edit
  created_by                uuid not null references public.profiles (id),
  updated_by                uuid references public.profiles (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  search                    tsvector generated always as (
                              setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                              setweight(to_tsvector('english', coalesce(description, '') || ' ' ||
                                coalesce(location, '') || ' ' || coalesce(preparation_notes, '')), 'B')
                            ) stored,
  check (end_time is null or (start_time is not null and end_time > start_time))
);
create index activities_starts_at_idx    on public.activities (starts_at);
create index activities_status_start_idx on public.activities (status, starts_at);
create index activities_search_idx       on public.activities using gin (search);
create index activities_created_by_idx   on public.activities (created_by);

-- Who is involved and who gets notified. Exactly one of profile_id / contact_id.
create table public.activity_recipients (
  id              uuid primary key default gen_random_uuid(),
  activity_id     uuid not null references public.activities (id) on delete cascade,
  profile_id      uuid references public.profiles (id),
  contact_id      uuid references public.contacts (id),
  role            public.recipient_role not null,
  notify_email    boolean not null default true,
  notify_whatsapp boolean not null default false,                   -- Phase 8
  created_at      timestamptz not null default now(),
  check (num_nonnulls(profile_id, contact_id) = 1),
  check (role <> 'responsible' or profile_id is not null),          -- responsible = staff (confirm §11)
  unique (activity_id, profile_id),
  unique (activity_id, contact_id)
);
create unique index activity_one_responsible     on public.activity_recipients (activity_id) where role = 'responsible';
create index activity_recipients_profile_idx     on public.activity_recipients (profile_id);
create index activity_recipients_contact_idx     on public.activity_recipients (contact_id);

-- The queue. One row = one message to one person on one channel for one occurrence.
create table public.notification_jobs (
  id                  uuid primary key default gen_random_uuid(),
  kind                public.notification_kind not null,
  channel             public.notification_channel not null,
  dedupe_key          text not null unique check (char_length(dedupe_key) <= 200),  -- also the provider Idempotency-Key
  activity_id         uuid references public.activities (id),
  profile_id          uuid references public.profiles (id),
  contact_id          uuid references public.contacts (id),
  destination         text not null,          -- address snapshot; refreshed while pending
  period_start        date,                   -- weekly summary: Monday of the covered week
  basis_starts_at     timestamptz,            -- reminder: activity start this job was planned for
  scheduled_for       timestamptz not null,   -- intended send time
  run_after           timestamptz not null,   -- next eligible attempt (scheduled_for, then backoff)
  expires_at          timestamptz,            -- never send after this
  status              public.job_status not null default 'pending',
  status_reason       text,                   -- rescheduled | activity_cancelled | expired | empty_week | ...
  attempt_count       integer not null default 0,
  max_attempts        integer not null default 6,
  first_attempt_at    timestamptz,
  lease_expires_at    timestamptz,
  send_mode           public.notification_mode,   -- mode actually applied when sent
  rendered_subject    text,                   -- frozen at first attempt: retries resend an identical payload
  rendered_html       text,
  rendered_text       text,
  provider            text,
  provider_message_id text,
  accepted_at         timestamptz,            -- provider ACCEPTED the request
  delivery_status     public.delivery_status not null default 'unknown',   -- provider CONFIRMED outcome
  delivery_updated_at timestamptz,
  last_error_code     text,
  last_error_message  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (num_nonnulls(profile_id, contact_id) <= 1),
  check (kind <> 'day_before_reminder' or (activity_id is not null and basis_starts_at is not null)),
  check (kind <> 'weekly_summary' or period_start is not null),
  unique (provider, provider_message_id)
);
create index notification_jobs_due_idx      on public.notification_jobs (run_after) where status in ('pending', 'processing');
create index notification_jobs_activity_idx on public.notification_jobs (activity_id);
create index notification_jobs_period_idx   on public.notification_jobs (kind, period_start);
-- dedupe_key formats:
--   rem:email:<activity_id>:<p|c>:<person_id>:<unix start>   (start time in key => reschedule = new job)
--   sum:email:<YYYY-MM-DD Monday>:<p|c>:<person_id>          (once per person per week)
--   test:email:<uuid>

-- Append-only event history for jobs and dispatcher runs.
create table public.notification_logs (
  id                  bigint generated always as identity primary key,
  job_id              uuid references public.notification_jobs (id),   -- null for run-level events
  run_id              uuid,
  event               text not null,  -- planned | rescheduled | cancelled | claimed | attempt | accepted | retry_scheduled
                                      -- | failed | skipped | webhook.<type> | run.started | run.finished
  attempt             integer,
  provider            text,
  provider_message_id text,
  provider_event_id   text unique,    -- svix-id: ignores webhook redeliveries
  http_status         integer,
  error_code          text,
  error_message       text,
  details             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index notification_logs_job_idx   on public.notification_logs (job_id, created_at);
create index notification_logs_event_idx on public.notification_logs (event, created_at desc);

-- Single-row, typed settings (validated columns rather than a free-form key/value store).
create table public.system_settings (
  id                           boolean primary key default true check (id),
  office_name                  text not null default 'Office',
  timezone                     text not null default 'Africa/Lagos',
  notification_mode            public.notification_mode not null default 'test',
  test_redirect_email          extensions.citext,               -- test mode: all email goes here
  email_from_name              text not null default 'Office Reminders',
  email_reply_to               extensions.citext,               -- From address is pinned in function config
  weekly_summary_enabled       boolean not null default true,
  weekly_summary_send_time     time not null default '17:00',
  weekly_summary_send_if_empty boolean not null default false,
  weekly_summary_late_cutoff   interval not null default '16 hours',  -- 17:00 Sun + 16 h = 09:00 Mon
  reminder_lead                interval not null default '24 hours',
  date_only_reminder_time      time not null default '09:00',   -- on the preceding day
  reminder_min_notice          interval not null default '2 hours',   -- late-created activities
  dispatch_batch_size          integer not null default 25 check (dispatch_batch_size between 1 and 100),
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles (id)
);

-- Append-only audit trail. Written by SECURITY DEFINER triggers;
-- UPDATE/DELETE/TRUNCATE revoked from anon, authenticated and service_role.
create table public.audit_logs (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_id       uuid references public.profiles (id),   -- null = system (cron / dispatcher)
  action         text not null,  -- activity.insert | activity.update | activity.status_change | settings.update
                                 -- | profile.role_change | notification.test_sent | notification.manual_retry ...
  table_name     text,
  record_id      uuid,
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[]
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id, occurred_at desc);
create index audit_logs_actor_idx  on public.audit_logs (actor_id, occurred_at desc);
```

### Key database functions (built in Phases 2–5)

| Function | Security | Purpose |
|---|---|---|
| `is_admin()`, `is_active_staff()`, `can_view_activity(id)`, `can_edit_activity(id)` | definer, `stable`, `search_path = ''` | Policy helpers |
| `handle_new_user()` (trigger on `auth.users`) | definer | Creates a profile from invite metadata |
| `activities_derive_times()` (trigger) | invoker | Validates timezone, derives `starts_at`/`ends_at`, bumps `version` |
| `save_activity(payload jsonb, expected_version int)` | **invoker** (RLS applies) | Saves an activity and its recipients atomically, with a stale-edit check |
| `set_activity_status(id, status, reason)` | invoker | Complete or cancel, with a reason |
| `sync_activity_reminders(activity_id, p_now)` | definer | Called by triggers. Creates, revives or cancels reminder jobs |
| `plan_notifications(p_now)` | definer, cron only | Weekly summary jobs plus a reconcile pass over upcoming reminders |
| `weekly_summary_items(period_start)` | definer | Rows for `[Mon 00:00, next Mon 00:00)` local time |
| `claim_notification_jobs(run_id, batch, p_now)`, `complete_notification_job(...)` | definer, **service_role only** | Lease, claim and record outcomes |

---

## 5. Authorisation (RLS) matrix

"Staff" means an authenticated user with an active profile. Inactive users fail every policy, and they're also banned in Auth.

| Table | Staff | Admin | Anonymous |
|---|---|---|---|
| profiles | Read all profiles (the staff directory; former staff still appear on old activities). Update own name and phone only; a trigger blocks changes to role, access, summary subscription and email | Full read/update. Can't demote or deactivate the last active admin | None |
| contacts | Read, create. Update the ones they created | Full | None |
| activities | Read `office` activities. Read `restricted` ones only if creator or recipient. Create as self. Update if creator or responsible person. **No delete** | Read and update all. No hard delete; cancel instead | None |
| activity_recipients | Follows the parent activity's read and edit rights | Full | None |
| notification_jobs | Read-only, for activities they can edit | Read. Retry and cancel via RPC (Phase 5) | None |
| notification_logs | None | Read only | None |
| system_settings | None. If the UI needs the office name or time zone, a function will expose them (Phase 3) | Read and update | None |
| audit_logs | None | Read only | None |

- **Implemented in stage 2c:** `supabase/migrations/20261015090000_access_policies.sql`, verified by `supabase/tests/database/05_access_policies.test.sql`. Signed-in users hold no `DELETE` on activities and no `TRUNCATE` anywhere, because `TRUNCATE` would bypass RLS.
- The browser only ever holds the publishable key. The secret key exists only in server-side code: the admin invite action and the Edge Functions.
- Every server action re-checks authorisation and does not rely on the UI hiding buttons.

---

## 6. Screens (Phase 3 onward)

- **Activity form:** all brief fields, multiple collaborators/recipients (staff picker plus external contacts), and notification toggles. Zod validation on the client and again on the server, and the database constraints are the final guard.
- **Register:** search (full-text), filters (date range, status, person), chronological list, calendar (month/week), detail page with history from `audit_logs`, and actions (edit, reschedule, complete, cancel).
- **Admin:** staff and invitations, summary recipients, schedule and email settings, notification mode, summary preview, "send test to me", job and log viewer (with retry/cancel), audit log, and scheduler health.

---

## 7. Notification design

### 7.1 Job lifecycle
```
             plan / sync
                 │
                 ▼
   ┌───────── pending ◄─────────── retry (backoff; attempts < max; before expires_at)
   │             │ claim (5-min lease, SKIP LOCKED)               ▲
   │             ▼                                                 │
   │        processing ── retryable error (network, 429, 5xx) ────┘
   │             │  ├── non-retryable error / attempts exhausted ──► failed   (admin alerted)
   │             │  └── re-validation fails / expired / empty week ─► skipped (reason recorded)
   │             └── provider accepted ──► sent ──(webhook)──► delivery_status: delivered | bounced | complained | ...
   └── activity cancelled / completed / rescheduled / recipient removed ──► cancelled
```
If a dispatcher dies mid-send, its lease expires. The job is re-claimed and resent with the **same Idempotency-Key and frozen payload**, so Resend returns the original result instead of sending a duplicate.

### 7.2 Weekly office summary
1. `plan_notifications()` works out this week's and next week's Sunday in the office timezone:
   - `send_at = (sunday + weekly_summary_send_time) AT TIME ZONE tz`
   - `period_start = sunday + 1` (the Monday)
2. It upserts one job per active subscriber (`sum:email:<monday>:<person>`). Unsubscribed people's pending jobs are cancelled. A changed send time moves pending jobs.
3. When the jobs are due, the dispatcher loads `weekly_summary_items(period_start)`:
   - Window: `starts_at >= monday 00:00 local` **and** `starts_at < next monday 00:00 local`.
   - Included: `status = 'scheduled'`, `include_in_weekly_summary`, `visibility = 'office'`.
4. If the week is empty and `send_if_empty = false`, the jobs are marked `skipped (empty_week)`. That's still visible to admins.
5. Content is grouped by day (Mon to Sun): time or "All day", title, location or meeting link, responsible person, collaborators (names only), and preparation notes.
6. **Each email is addressed to one recipient.** There are no visible lists and no BCC.
7. If an outage delays the summary, it's still sent up to `late_cutoff` (default 09:00 Monday) and marked "(delayed)". After that it's skipped and flagged.

### 7.3 Day-before reminders
- **Timed activity:** `scheduled_for = starts_at − reminder_lead` (default 24 h).
- **Date-only activity:** `scheduled_for = (activity_date − 1) + date_only_reminder_time` (default 09:00), in the office timezone.
- `expires_at = starts_at`. A reminder is never sent after the activity has started.
- **Late-created activity** (its reminder time has already passed): sent immediately if at least `reminder_min_notice` (default 2 h) remains before the start; otherwise no reminder.
- A trigger on `activities`/`activity_recipients` runs `sync_activity_reminders` **in the same transaction** as the edit:
  - Rescheduled: the start time is part of the key, so the old job is `cancelled (rescheduled)` and a new one created. If the activity moves back to its original time, the old job is revived. If that one was already sent, it isn't sent again.
  - Cancelled or completed, reminders off, or recipient removed: pending jobs are `cancelled` with a reason.
  - Content-only edits (title, notes): no job change. Content is rendered at send time.
- Every 5 minutes the planner also re-syncs all upcoming activities. This self-heals after settings changes or anything missed.
- **Re-validation at send time:** right before sending, the dispatcher re-checks that the activity is still `scheduled`, reminders are still on, `starts_at` equals the job's `basis_starts_at`, the recipient is still present and opted in, and now is before `expires_at`. Any failure marks the job `skipped`.

### 7.4 Duplicate prevention (layers)
1. `dedupe_key UNIQUE`: one job per person per occurrence. Re-planning is an upsert.
2. `FOR UPDATE SKIP LOCKED` with a lease: concurrent or overlapping runs can't claim the same job.
3. The provider `Idempotency-Key = dedupe_key` plus a payload frozen at the first attempt. A retry after a crash returns the original result (the 24 h key window).
4. A job whose first attempt was more than 20 h ago and whose outcome is unknown is **not auto-retried**, because it's close to the end of the idempotency window. It's marked `failed (outcome_unknown)` for an admin to check in the Resend dashboard.

### 7.5 Retries and error classification
- **Retryable:** network or timeout, HTTP 429 (respect `Retry-After`), 5xx, and `409 concurrent_idempotent_requests`. Backoff is 1 → 5 → 15 → 60 → 180 min, capped at `expires_at`.
- **Non-retryable:** 4xx validation such as an invalid address. Also 401/403 (bad API key: alert admins). Also `409 invalid_idempotent_request` (a payload mismatch, which shouldn't happen with frozen payloads, so it's flagged).
- **Every attempt writes a `notification_logs` row** with status code and error. Permanent failures go into a rate-limited alert email to admins and a red badge on the dashboard.

### 7.6 Outage and recovery behaviour

| Situation | Behaviour |
|---|---|
| Nobody is using the website | No effect. The clock is `pg_cron` inside the database |
| Web host down | No effect. The notification pipeline runs entirely in Supabase |
| Dispatcher crashes mid-batch | Lease expires (5 min), job re-claimed, and the idempotent resend produces no duplicate |
| Resend outage, 429 or 5xx | Backoff retries until `expires_at`, then `failed` plus an alert |
| Supabase outage or missed cron ticks | The next tick catches up on everything due. Reminders for activities that have already started are `skipped (expired)`. The summary is sent late until the cutoff |
| Bounce or invalid address | `failed` or `delivery_status = bounced`, visible in the log viewer |
| Activity edited while a retry is pending | Re-validated on every attempt. A reschedule supersedes the job |

### 7.7 Accepted vs delivered
- `status = 'sent'` with `accepted_at` and `provider_message_id` means **the provider accepted the request**.
- `delivery_status` is updated from Resend webhooks (`email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`).
- The webhook function needs the **raw body** to verify the Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`). Redeliveries are de-duplicated on `svix-id`.
- Open and click tracking stay **off**. They aren't needed, and leaving them off is better for privacy.

### 7.8 Test-mode safety ("test mode cannot accidentally send real notifications")

| `system_settings.notification_mode` | Edge env `NOTIFICATIONS_LIVE` | Result |
|---|---|---|
| `off` | any | Due jobs `skipped (notifications_off)`. They don't pile up and fire later |
| `test` | any | Emails go **only** to `test_redirect_email` with a "[TEST]" subject and a banner showing the intended recipient. With no redirect address set, the `log` provider is used (no network) |
| `live` | not `"true"` | Behaves as `test`, and the dashboard shows a warning |
| `live` | `"true"` | Real recipients |

- `NOTIFICATIONS_LIVE` is set **only** in the production project's function secrets. Local and staging never have it, and the code defaults to the `log` provider when no Resend key is present.
- "Send test to me" always sends to the acting admin's own address and nothing else.
- Unit tests cover this whole matrix.

### 7.9 Provider interface and WhatsApp readiness
```ts
interface NotificationProvider {
  readonly channel: 'email' | 'whatsapp';
  readonly name: string;                                   // 'resend' | 'log' | later 'meta_whatsapp' | 'twilio'
  send(msg: OutboundMessage, opts: { idempotencyKey: string }): Promise<SendResult>;
}
type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; code: string; message: string; httpStatus?: number; retryAfterMs?: number };
```
- Each channel's message is a **separate job**. A WhatsApp failure can't block or delay email.
- Already in place for Phase 8: phone numbers, per-person consent timestamps, `notify_whatsapp` flags, and the `whatsapp` channel enum.
- Phase 8 adds: template mapping, a callback webhook function, and opt-out handling.

---

## 8. Acceptance criteria: mechanism and test

| Criterion | Mechanism | Test / evidence (phase) |
|---|---|---|
| Activities stored correctly | Zod (client and server), DB constraints, atomic `save_activity` | Vitest, pgTAP, Playwright (P3) |
| Summary covers only the intended range | Half-open `[Mon 00:00, next Mon 00:00)` in the office timezone, in SQL | pgTAP boundaries: Sun 23:59, Mon 00:00, Sun 23:59 (end), next Mon 00:00, date-only (P4) |
| Summary sent once per week | Unique `sum:` key plus idempotency key | Run planner and dispatcher N times in simulated time and assert one send per person (P4) |
| Reminders reach intended recipients | Recipient rows become jobs; delivery webhook | Log-provider assertions, then real sends to test inboxes on staging (P5) |
| Cancelled/completed: no reminders | Trigger cancels jobs, plus send-time re-validation | pgTAP and dispatcher tests (P5–P6) |
| Rescheduling updates notifications | Start time in the dedupe key; supersede and revive | pgTAP (P5) |
| Retries don't duplicate | Lease, SKIP LOCKED, Idempotency-Key, frozen payload | Fault injection: crash after provider accept, then rerun (P5) |
| Failures recorded and investigable | Job status, logs, webhooks, admin log viewer | Provider-failure simulation (P5) |
| No access outside permissions | RLS plus server-side checks | pgTAP RLS matrix per role (P2, P6) |
| Works with nobody on the site | `pg_cron` in the database | Staging observed over a weekend with no logins (P6–P7) |
| Recovers after interruption | Catch-up, lease expiry, late cutoff | Disable cron or fake a provider outage, then restore (P6) |
| Test mode can't send real email | Two-switch gate, redirect, `log` default | Unit tests on the gate matrix; staging has no live flag (P4–P5) |

---

## 9. Environments, deployment, backups and monitoring

### Environments
| Env | Supabase | Web | Email | Mode |
|---|---|---|---|---|
| Local | CLI + Docker (`supabase start`); auth emails caught by the CLI's local mail catcher | `next dev` | `log` provider (no network) | test |
| Staging | Free-plan project (separate org; pausing is acceptable for staging) | Host preview/staging deployment | Restricted Resend key; redirected to a test inbox | test (`NOTIFICATIONS_LIVE` never set) |
| Production | Pro project in the region nearest Lagos; web function region matched to it | Production deployment | Resend production key; verified domain (SPF, DKIM, DMARC) | test for the first 2 Sundays, then live |

### Release flow
- Feature branch → PR → CI runs typecheck, lint, Vitest, Deno tests, and `supabase db reset` plus `supabase test db` on a local stack.
- Merge to `main` → the web app auto-deploys.
- DB migrations (`supabase db push`) and Edge Functions (`supabase functions deploy`) are deployed by a GitHub Action that needs manual approval (GitHub Environments). Before that Action exists, they're run by hand from a documented checklist.

### Secrets (an `.env.example` template is added in Phase 2; real values never committed)
- **Web host:**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY` (server-only, used only for admin invites)
  - `NEXT_PUBLIC_APP_URL`
- **Edge Function secrets:**
  - `RESEND_API_KEY`
  - `RESEND_WEBHOOK_SECRET`
  - `DISPATCH_SECRET`
  - `NOTIFICATIONS_LIVE` (production only)
  - `EMAIL_FROM_ADDRESS`
  - `APP_URL`
  - `HEARTBEAT_URL`
- **Supabase Vault** (read by `pg_cron`): `dispatch_url`, `dispatch_secret`.

### Backups and restoration
- Supabase Pro includes daily backups with 7-day retention.
- On top of that, a weekly encrypted logical dump (`supabase db dump`: schema, data, roles) is stored **off-platform** in office-controlled storage with 90-day retention.
- **Targets:** RPO ≤ 24 h, RTO about 4 h.
- **Restore drill** into staging before go-live, then quarterly.
- PITR (US$100/month) isn't justified at this size.

### Monitoring
- Every dispatcher run logs `run.started`/`run.finished`. The admin dashboard shows "last run N min ago" and turns red after 15 min.
- At the end of each run, the dispatcher pings an external dead-man's-switch service (e.g. Healthchecks.io; free tier and terms to be verified in Phase 7). That way someone is alerted even when the whole system is silent.
- Admins get an alert email for permanent job failures.

### Routine maintenance
- **Monthly:** review failed or bounced jobs; apply Dependabot updates; check Supabase and Resend usage.
- **Quarterly:** restore drill; access review (deactivate leavers).
- **Yearly, or when staff leave:** rotate keys.
- **Automatic pruning:** `notification_logs` after 12 months; rendered email bodies after 6 months.

---

## 10. Cost estimate (USD, checked 2026-10-13, excludes VAT)

**Volume estimate:**
- About 15 activities/week × about 3 notified people gives roughly 195 reminders/month.
- 20 summary recipients × 4.3 weeks gives about 86 summaries/month.
- Total: **about 300 emails/month**. The peak day (Sunday) is about 40, well within Resend Free (3,000/month, 100/day).

| Item | Recommended production | Budget production | Notes |
|---|---|---|---|
| Supabase | **Pro $25/mo** | Pro $25/mo | Free is unsuitable for production: it pauses after 1 week of inactivity and has no backups. Pro includes a $10 compute credit (one Micro instance), daily backups with 7-day retention, and no pausing |
| Web hosting | **Vercel Pro $20/mo** (1 developer seat) | Netlify Free $0 or Personal $9/mo | Vercel Hobby is non-commercial only. Netlify's pricing page shows no commercial restriction on Free, **but check their terms before relying on that** |
| Email (Resend) | Free $0 | Free $0 | 3,000/month, 100/day, 1 webhook endpoint. Upgrade to Pro ($20/mo, 50,000/month, no daily cap) only if volume grows |
| Domain / DNS | Existing office domain $0 | same | Needs DNS access for SPF/DKIM/DMARC. A new domain costs about $10–20/year |
| GitHub | Free | Free | Private repo |
| Staging | Supabase Free $0 | $0 | A separate free org, so it doesn't add Pro compute costs |
| Monitoring | Free tier (verify in Phase 7) | same | |
| **Total** | **≈ $45/mo** | **≈ $25–34/mo** | |

**WhatsApp (Phase 8, indicative only, not verified against Meta's rate card):**
- Meta charges per template message. One secondary source quotes about **US$0.01 per utility message to a Nigerian number**.
- Twilio adds its own per-message fee on top.
- At about 200 reminders/month that's roughly $2–5/month. This must be re-verified in Phase 8; Meta changes prices at quarter starts.

---

## 11. Decisions (all bold defaults ACCEPTED 2026-10-14)

Item 9 (sending domain) has no default and is still open. It's needed before Phase 7.

1. **Hosting:** **Vercel Pro ($20/mo)**, or the budget host?
2. **Visibility:** **All active staff see all `office` activities. `restricted` ones are visible only to the creator, recipients and admins, and are left out of the summary.** Is that right?
3. **Who may edit:** **creator, responsible person, admins.**
4. **Responsible person:** **must be a staff member (one per activity).** Collaborators can be staff or external.
5. **Sign-in:** **invite-only, email + password with self-service reset.** The alternative is a one-time email code with no passwords.
6. **Default times:**
   - Sunday summary at **17:00 WAT**.
   - Date-only reminders at **09:00 the day before**.
   - Late-created activities: **remind immediately if at least 2 h before the start, otherwise no reminder**.
   - Late summary cutoff: **Monday 09:00**.
7. **Summary list:** **all active staff by default.** Admins can remove people or add external addresses, such as a group mailbox.
8. **Empty week:** **don't send.**
9. **Sending domain:** which domain (and do you have DNS access)? Suggested sender: `reminders@<your-domain>`.
10. **Statuses:** are **scheduled / completed / cancelled** enough, or do you need "tentative" or "postponed (date TBC)"?
11. **Retention:** **activities kept indefinitely**; notification logs 12 months?
12. **Local development:** **install WSL 2 + Docker Desktop** for a local Supabase stack. The alternative is a hosted free dev project, with no Docker but shared state and weekly pausing.

---

## 12. Implementation roadmap

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **1. Environment & requirements** (current) | Environment report, setup commands, this document | §11 answered; Node 24 and Docker verified; document approved |
| **2. Foundations** | Git and GitHub repo, `.gitignore`/`.gitattributes`, Next.js scaffold, Supabase CLI project, migrations (enums, tables, constraints, indexes, RLS, audit triggers, profile trigger), invite-only auth, `.env.example`, CI skeleton | `supabase db reset` is clean; pgTAP RLS matrix passes; sign-in works locally |
| **3. Activities** | Form (Zod), `save_activity` RPC, register with search and filters, calendar, detail and history, edit with version check, complete, cancel, reschedule | Unit, DB and E2E tests for create, edit, cancel and permission denial |
| **4. Weekly summary** | Planner (summary part), `weekly_summary_items`, templates, dispatcher with the `log` provider, admin preview, mode gate | Boundary tests pass; "once per week" holds under repeated simulated runs |
| **5. Reminders and reliability** | Reminder sync triggers, reconcile pass, claim/lease, Resend provider with idempotency, retries and backoff, webhook function, log viewer, retry/cancel, "send test to me" | Crash-after-accept test shows no duplicate; webhook signature tests; retry tests |
| **6. Hardening** | Timezone, cancellation, reschedule, permission and outage/restore test suites | Every §8 row has recorded evidence |
| **7. Production** | Supabase Pro, domain DNS, custom auth SMTP, hosting, secrets, cron, backups and restore drill, monitoring, handover runbook (operations, costs, maintenance) | Two Sundays observed in production test mode, then switched to live |
| **8. WhatsApp** | Re-verify Meta/Twilio docs and pricing; consent capture; templates; provider; callbacks; cost controls | Email suite still green; WhatsApp acceptance tests pass |

---

## 13. Phase 1: environment report (2026-10-13)

| Check | Found | Action |
|---|---|---|
| Project folder | Empty, not a git repo | `git init` in Phase 2 |
| Node.js | v20.20.2 active (EOL); v25.4.0 also installed (EOL); managed by nvm-windows | Install **Node 24 LTS** (24.21.0 is the latest LTS on nodejs.org) |
| npm | 10.8.2 | Comes with Node 24 |
| Git | 2.52.0, identity set, `init.defaultBranch` unset | Set `main` |
| Docker | Not installed | Install Docker Desktop (needs WSL 2) |
| WSL | Not installed. **Hypervisor present**, so virtualisation is available | `wsl --install --no-distribution` (admin, reboot) |
| Supabase CLI | Not installed | Project devDependency `supabase` (2.120.0) in Phase 2, run via `npx supabase` |
| Deno | Not installed | Optional: Edge Function tests and editor support |
| GitHub CLI / Vercel CLI | Not installed | Optional |
| VS Code | Installed | Add the Deno extension, scoped to `supabase/functions` |
| Hardware | 15.5 GB RAM, 114 GB free disk | Enough for Docker and the local Supabase stack |
| PowerShell policy | CurrentUser RemoteSigned | OK for npm shims |

**Current package versions (npm, 2026-10-13):**

| Package | Version |
|---|---|
| `next` | 16.4.0 |
| `react` | 19.3.0 |
| `@supabase/supabase-js` | 2.117.3 |
| `@supabase/ssr` | 0.12.7 |
| `@supabase/server` | 1.9.2 |
| `supabase` (CLI) | 2.120.0 |
| `resend` | 6.32.1 |
| `zod` | 4.6.7 |
| `typescript` | 7.0.2 (compatibility check in Phase 2) |
| `svix` | 2.8.0 |
| `vitest` | 5.0.4 |
| `@playwright/test` | 1.64.0 |

Docker Desktop is free for small businesses. Confirm the office meets Docker's current small-business licence terms.

---

## 14. Sources (checked 2026-10-13)
- Supabase: [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) · [Pricing](https://supabase.com/pricing) · [Edge Function limits](https://supabase.com/docs/guides/functions/limits) · [Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [API keys](https://supabase.com/docs/guides/api/api-keys)
- Resend: [Pricing](https://resend.com/pricing) · [Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) · [Webhook event types](https://resend.com/docs/dashboard/webhooks/event-types) · [Verifying webhooks](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests)
- Vercel: [Hobby plan](https://vercel.com/docs/plans/hobby) · Netlify: [Pricing](https://www.netlify.com/pricing/)
- Node.js: [Releases](https://nodejs.org/en/about/previous-releases)
- WhatsApp: [Meta pricing docs](https://developers.facebook.com/docs/whatsapp/pricing) · [MSME Africa report (secondary, unverified)](https://msmeafricaonline.com/whatsapp-to-charge-businesses-for-customer-replies-from-october-2026/)
