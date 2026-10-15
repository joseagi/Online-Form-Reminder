-- Notification queue and its event log. Rows are written only by server-side database
-- functions and the dispatcher (Phases 4-5); signed-in users may at most read them.

create table public.notification_jobs (
  id                  uuid primary key default gen_random_uuid(),
  kind                public.notification_kind not null,
  channel             public.notification_channel not null,
  -- One job per person per occurrence; also sent to the provider as the Idempotency-Key.
  --   rem:email:<activity_id>:<p|c>:<person_id>:<unix start>
  --   sum:email:<YYYY-MM-DD Monday>:<p|c>:<person_id>
  --   test:email:<uuid>
  dedupe_key          text not null unique check (char_length(dedupe_key) between 1 and 200),
  activity_id         uuid references public.activities (id),
  profile_id          uuid references public.profiles (id),
  contact_id          uuid references public.contacts (id),
  destination         text not null check (char_length(destination) between 1 and 320),
  period_start        date,                   -- weekly summary: Monday of the covered week
  basis_starts_at     timestamptz,            -- reminder: activity start this job was planned for
  scheduled_for       timestamptz not null,   -- intended send time
  run_after           timestamptz not null,   -- next eligible attempt (scheduled_for, then backoff)
  expires_at          timestamptz,            -- never send after this
  status              public.job_status not null default 'pending',
  status_reason       text,
  attempt_count       integer not null default 0,
  max_attempts        integer not null default 6 check (max_attempts between 1 and 20),
  first_attempt_at    timestamptz,
  lease_expires_at    timestamptz,
  send_mode           public.notification_mode,
  rendered_subject    text,                   -- frozen at first attempt so retries resend an identical payload
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
  constraint notification_jobs_one_person    check (num_nonnulls(profile_id, contact_id) <= 1),
  constraint notification_jobs_attempts      check (attempt_count between 0 and max_attempts),
  constraint notification_jobs_reminder_refs check (kind <> 'day_before_reminder'
                                                    or (activity_id is not null and basis_starts_at is not null)),
  constraint notification_jobs_summary_refs  check (kind <> 'weekly_summary' or period_start is not null),
  constraint notification_jobs_sent_has_ack  check (status <> 'sent'
                                                    or (accepted_at is not null and provider_message_id is not null)),
  constraint notification_jobs_provider_msg_key unique (provider, provider_message_id)
);
create index notification_jobs_due_idx      on public.notification_jobs (run_after) where status in ('pending', 'processing');
create index notification_jobs_activity_idx on public.notification_jobs (activity_id);
create index notification_jobs_period_idx   on public.notification_jobs (kind, period_start);
create index notification_jobs_profile_idx  on public.notification_jobs (profile_id);
create index notification_jobs_contact_idx  on public.notification_jobs (contact_id);

create trigger notification_jobs_set_updated_at
  before update on public.notification_jobs
  for each row execute function public.set_updated_at();

create table public.notification_logs (
  id                  bigint generated always as identity primary key,
  job_id              uuid references public.notification_jobs (id) on delete cascade,  -- null for run-level events
  run_id              uuid,
  event               text not null check (char_length(event) between 1 and 60),
  attempt             integer,
  provider            text,
  provider_message_id text,
  provider_event_id   text unique,            -- svix-id: ignores webhook redeliveries
  http_status         integer,
  error_code          text,
  error_message       text,
  details             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index notification_logs_job_idx   on public.notification_logs (job_id, created_at);
create index notification_logs_event_idx on public.notification_logs (event, created_at desc);

alter table public.notification_jobs enable row level security;
alter table public.notification_logs enable row level security;

revoke all on public.notification_jobs, public.notification_logs from anon, authenticated;
grant select on public.notification_jobs, public.notification_logs to authenticated;
