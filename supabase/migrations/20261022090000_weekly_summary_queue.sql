-- Phase 4a: the weekly office summary (content + planner) and the queue operations the
-- dispatcher Edge Function uses (claim, freeze payload, record outcome, run log).
--
-- Every time-dependent function takes p_now so tests can simulate any moment. None of these are
-- callable by signed-in users: only by the service role (the dispatcher) and the database owner
-- (pg_cron).

-- What goes into the summary for the week starting p_period_start (a Monday) in the office's
-- time zone: scheduled, office-visible activities from Monday 00:00 up to the next Monday 00:00.
create function public.weekly_summary_items(p_period_start date)
returns table (
  activity_id        uuid,
  title              text,
  activity_date      date,
  start_time         time,
  end_time           time,
  timezone           text,
  starts_at          timestamptz,
  location           text,
  meeting_url        text,
  preparation_notes  text,
  responsible_name   text,
  collaborator_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.activity_date, a.start_time, a.end_time, a.timezone, a.starts_at,
         a.location, a.meeting_url, a.preparation_notes,
         (select p.full_name
            from public.activity_recipients r
            join public.profiles p on p.id = r.profile_id
           where r.activity_id = a.id and r.role = 'responsible'),
         coalesce((select array_agg(coalesce(p.full_name, c.full_name) order by coalesce(p.full_name, c.full_name))
                     from public.activity_recipients r
                     left join public.profiles p on p.id = r.profile_id
                     left join public.contacts c on c.id = r.contact_id
                    where r.activity_id = a.id and r.role = 'collaborator'), '{}')
    from public.activities a
   cross join public.system_settings s
   where a.status = 'scheduled'
     and a.visibility = 'office'
     and a.include_in_weekly_summary
     and a.starts_at >= (p_period_start::timestamp at time zone s.timezone)
     and a.starts_at <  ((p_period_start + 7)::timestamp at time zone s.timezone)
   order by a.starts_at, a.title;
$$;

-- Makes sure each subscriber has exactly one summary job for this week's and next week's Sunday.
-- Safe to run as often as you like. Returns how many jobs it created or changed.
--   * Jobs follow changes to the send time, the late cutoff and the subscriber list until sent.
--   * A Sunday is left alone once its late cutoff has passed (the dispatcher skips stale jobs).
--   * Jobs that were sent, failed or skipped are never touched again: once per week, per person.
create function public.plan_weekly_summaries(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s              public.system_settings;
  v_today        date;
  v_last_sunday  date;
  v_sunday       date;
  v_period       date;
  v_send_at      timestamptz;
  v_expires_at   timestamptz;
  v_changed      integer := 0;
  v_count        integer;
begin
  select * into s from public.system_settings;
  v_today := (p_now at time zone s.timezone)::date;
  -- The most recent Sunday (today if it is Sunday). isodow: Monday = 1 ... Sunday = 7.
  v_last_sunday := v_today - (extract(isodow from v_today)::integer % 7);

  foreach v_sunday in array array[v_last_sunday, v_last_sunday + 7] loop
    v_period     := v_sunday + 1;
    v_send_at    := (v_sunday + s.weekly_summary_send_time) at time zone s.timezone;
    v_expires_at := v_send_at + s.weekly_summary_late_cutoff;

    continue when p_now >= v_expires_at;

    if not s.weekly_summary_enabled then
      update public.notification_jobs
         set status = 'cancelled', status_reason = 'summary_disabled'
       where kind = 'weekly_summary' and period_start = v_period and status = 'pending';
      get diagnostics v_count = row_count;
      v_changed := v_changed + v_count;
      continue;
    end if;

    -- One job per subscriber: active staff who receive it, and active contacts with an email.
    insert into public.notification_jobs as j
      (kind, channel, dedupe_key, profile_id, contact_id, destination,
       period_start, scheduled_for, run_after, expires_at)
    select 'weekly_summary'::public.notification_kind, 'email'::public.notification_channel,
           format('sum:email:%s:%s:%s', v_period, sub.kind, sub.id),
           case when sub.kind = 'p' then sub.id end,
           case when sub.kind = 'c' then sub.id end,
           sub.email, v_period, v_send_at, v_send_at, v_expires_at
      from (select 'p' as kind, p.id, p.email::text as email
              from public.profiles p
             where p.is_active and p.receives_weekly_summary
            union all
            select 'c', c.id, c.email::text
              from public.contacts c
             where c.is_active and c.receives_weekly_summary and c.email is not null) as sub
    on conflict (dedupe_key) do update
       set destination   = excluded.destination,
           scheduled_for = excluded.scheduled_for,
           run_after     = excluded.run_after,
           expires_at    = excluded.expires_at,
           status        = 'pending',
           status_reason = null
     where j.status in ('pending', 'cancelled')
       and (j.status, j.destination, j.scheduled_for, j.expires_at)
           is distinct from ('pending'::public.job_status, excluded.destination, excluded.scheduled_for, excluded.expires_at);
    get diagnostics v_count = row_count;
    v_changed := v_changed + v_count;

    -- People who stopped receiving it, or left, before it went out.
    update public.notification_jobs j
       set status = 'cancelled', status_reason = 'unsubscribed'
     where j.kind = 'weekly_summary'
       and j.period_start = v_period
       and j.status = 'pending'
       and not exists (select 1 from public.profiles p
                        where p.id = j.profile_id and p.is_active and p.receives_weekly_summary)
       and not exists (select 1 from public.contacts c
                        where c.id = j.contact_id and c.is_active and c.receives_weekly_summary and c.email is not null);
    get diagnostics v_count = row_count;
    v_changed := v_changed + v_count;
  end loop;

  return v_changed;
end;
$$;

-- Hands due jobs to one dispatcher run. Concurrent runs never get the same job (SKIP LOCKED),
-- and a job whose run crashed is handed out again once its lease expires: the dispatcher then
-- re-sends with the same idempotency key, so the provider does not send twice.
-- First, jobs that ran out of time are closed:
--   * pending past their deadline           -> skipped (expired)
--   * in progress, lease expired, and past the deadline, out of attempts, or first tried over
--     20 hours ago (beyond the provider's 24-hour idempotency window) -> failed (outcome_unknown),
--     because the earlier attempt may or may not have been delivered.
create function public.claim_notification_jobs(
  p_run_id uuid,
  p_limit  integer default 25,
  p_now    timestamptz default now(),
  p_lease  interval default '5 minutes')
returns setof public.notification_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  with closed as (
    update public.notification_jobs j
       set status           = case when j.status = 'pending' then 'skipped' else 'failed' end::public.job_status,
           status_reason    = case when j.status = 'pending' then 'expired' else 'outcome_unknown' end,
           lease_expires_at = null
     where (j.status = 'pending' and j.expires_at <= p_now)
        or (j.status = 'processing' and j.lease_expires_at <= p_now
            and (j.expires_at <= p_now
                 or j.attempt_count >= j.max_attempts
                 or j.first_attempt_at <= p_now - interval '20 hours'))
    returning j.id, j.status, j.status_reason
  )
  insert into public.notification_logs (job_id, run_id, event, details)
  select c.id, p_run_id, c.status::text, jsonb_build_object('reason', c.status_reason)
    from closed c;

  return query
  with due as (
    select j.id
      from public.notification_jobs j
     where (j.status = 'pending' and j.run_after <= p_now)
        or (j.status = 'processing' and j.lease_expires_at <= p_now)
     order by j.run_after, j.id
     limit p_limit
     for update skip locked
  ), claimed as (
    update public.notification_jobs j
       set status           = 'processing',
           attempt_count    = j.attempt_count + 1,
           first_attempt_at = coalesce(j.first_attempt_at, p_now),
           lease_expires_at = p_now + p_lease
      from due
     where j.id = due.id
    returning j.*
  ), logged as (
    insert into public.notification_logs (job_id, run_id, event, attempt)
    select c.id, p_run_id, 'claimed', c.attempt_count from claimed c
  )
  select * from claimed;
end;
$$;

-- Stores the rendered message the first time a job is attempted and returns what is stored, so
-- every retry sends exactly the same payload (required for the provider's idempotency key).
create function public.freeze_notification_payload(p_job_id uuid, p_subject text, p_html text, p_text text)
returns table (subject text, html text, body_text text)
language sql
security definer
set search_path = ''
as $$
  update public.notification_jobs
     set rendered_subject = coalesce(rendered_subject, p_subject),
         rendered_html    = coalesce(rendered_html, p_html),
         rendered_text    = coalesce(rendered_text, p_text)
   where id = p_job_id
     and status = 'processing'
  returning rendered_subject, rendered_html, rendered_text;
$$;

-- Records what happened to a claimed job. p_outcome:
--   'sent'    the provider accepted it (delivery is confirmed separately, by webhook)
--   'retry'   a temporary failure: try again after a growing wait, unless out of attempts/time
--   'failed'  a permanent failure (e.g. invalid address)
--   'skipped' deliberately not sent (p_reason says why, e.g. 'empty_week', 'notifications_off')
-- Returns the job's new status.
create function public.complete_notification_job(
  p_job_id              uuid,
  p_run_id              uuid,
  p_outcome             text,
  p_provider            text default null,
  p_provider_message_id text default null,
  p_send_mode           public.notification_mode default null,
  p_http_status         integer default null,
  p_error_code          text default null,
  p_error_message       text default null,
  p_reason              text default null,
  p_retry_after         interval default null,
  p_now                 timestamptz default now())
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  j          public.notification_jobs;
  v_backoff  constant interval[] := array['1 minute', '5 minutes', '15 minutes', '1 hour', '3 hours']::interval[];
  v_next     timestamptz;
  v_status   public.job_status;
  v_reason   text := p_reason;
begin
  select * into j from public.notification_jobs where id = p_job_id for update;
  if not found or j.status <> 'processing' then
    raise exception 'Job % is not being processed', p_job_id using errcode = '22023';
  end if;

  if p_outcome = 'sent' then
    v_status := 'sent';
    v_reason := null;
  elsif p_outcome = 'retry' then
    v_next := p_now + greatest(coalesce(p_retry_after, interval '0'), v_backoff[least(j.attempt_count, 5)]);
    if j.attempt_count >= j.max_attempts or (j.expires_at is not null and v_next >= j.expires_at) then
      v_status := 'failed';
      v_reason := 'retries_exhausted';
    else
      v_status := 'pending';
      v_reason := 'retrying';
    end if;
  elsif p_outcome = 'failed' then
    v_status := 'failed';
    v_reason := coalesce(p_reason, 'rejected');
  elsif p_outcome = 'skipped' then
    v_status := 'skipped';
  else
    raise exception 'Unknown outcome: %', p_outcome using errcode = '22023';
  end if;

  update public.notification_jobs
     set status              = v_status,
         status_reason       = v_reason,
         run_after           = case when v_status = 'pending' then v_next else run_after end,
         lease_expires_at    = null,
         provider            = coalesce(p_provider, provider),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         send_mode           = coalesce(p_send_mode, send_mode),
         accepted_at         = case when v_status = 'sent' then p_now else accepted_at end,
         last_error_code     = case when v_status = 'sent' then null else coalesce(p_error_code, last_error_code) end,
         last_error_message  = case when v_status = 'sent' then null else coalesce(p_error_message, last_error_message) end
   where id = p_job_id;

  insert into public.notification_logs
    (job_id, run_id, event, attempt, provider, provider_message_id, http_status, error_code, error_message, details)
  values
    (p_job_id, p_run_id,
     case v_status when 'sent' then 'accepted' when 'pending' then 'retry_scheduled' else v_status::text end,
     j.attempt_count, p_provider, p_provider_message_id, p_http_status, p_error_code, p_error_message,
     jsonb_strip_nulls(jsonb_build_object('reason', v_reason, 'retry_at', v_next, 'send_mode', p_send_mode)));

  return v_status;
end;
$$;

-- Run-level events (run.started / run.finished with counts): the scheduler's heartbeat.
create function public.log_dispatch_run(p_run_id uuid, p_event text, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_logs (run_id, event, details)
  values (p_run_id, p_event, coalesce(p_details, '{}'::jsonb));
$$;

revoke execute on function
  public.weekly_summary_items(date),
  public.plan_weekly_summaries(timestamptz),
  public.claim_notification_jobs(uuid, integer, timestamptz, interval),
  public.freeze_notification_payload(uuid, text, text, text),
  public.complete_notification_job(uuid, uuid, text, text, text, public.notification_mode, integer, text, text, text, interval, timestamptz),
  public.log_dispatch_run(uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.weekly_summary_items(date),
  public.plan_weekly_summaries(timestamptz),
  public.claim_notification_jobs(uuid, integer, timestamptz, interval),
  public.freeze_notification_payload(uuid, text, text, text),
  public.complete_notification_job(uuid, uuid, text, text, text, public.notification_mode, integer, text, text, text, interval, timestamptz),
  public.log_dispatch_run(uuid, text, jsonb)
to service_role;
