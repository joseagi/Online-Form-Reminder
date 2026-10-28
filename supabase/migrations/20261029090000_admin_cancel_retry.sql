-- Stage 5d: administrators can cancel a waiting message, send a failed one again, or undo their
-- own cancel. Both planners leave a message an administrator cancelled alone (they used to revive
-- any cancelled job they would plan again). A cancel applies to that one message: a reminder for
-- a new start time is a new message, and is planned as usual.

-- Same as in 20261024090000_day_before_reminders.sql, except that a job cancelled by an
-- administrator is not revived (see "where" at the end of step 2).
create or replace function public.sync_reminders(p_activity_id uuid default null, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s         public.system_settings;
  v_changed integer := 0;
  v_count   integer;
begin
  select * into s from public.system_settings;

  -- 1. Waiting jobs that should no longer go out.
  with stale as (
    select j.id, public.reminder_job_problem(j, p_now) as problem
      from public.notification_jobs j
     where j.kind = 'day_before_reminder'
       and j.status = 'pending'
       and (p_activity_id is null or j.activity_id = p_activity_id)
  )
  update public.notification_jobs j
     set status = 'cancelled', status_reason = stale.problem
    from stale
   where j.id = stale.id
     and stale.problem is not null
     and stale.problem <> 'expired';
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  -- 2. One job per person to remind: created, moved (settings changes) or revived.
  insert into public.notification_jobs as j
    (kind, channel, dedupe_key, activity_id, profile_id, contact_id, destination,
     basis_starts_at, scheduled_for, run_after, expires_at)
  select 'day_before_reminder'::public.notification_kind, 'email'::public.notification_channel,
         t.dedupe_key, t.activity_id,
         case when t.person_kind = 'p' then t.person_id end,
         case when t.person_kind = 'c' then t.person_id end,
         t.email, t.starts_at, t.remind_at, greatest(t.remind_at, p_now), t.starts_at
    from (select a.id as activity_id, a.starts_at,
                 case when r.profile_id is not null then 'p' else 'c' end as person_kind,
                 coalesce(r.profile_id, r.contact_id) as person_id,
                 coalesce(p.email::text, c.email::text) as email,
                 format('rem:email:%s:%s:%s:%s', a.id,
                        case when r.profile_id is not null then 'p' else 'c' end,
                        coalesce(r.profile_id, r.contact_id),
                        extract(epoch from a.starts_at)::bigint) as dedupe_key,
                 case when a.start_time is null
                      then ((a.activity_date - 1) + s.date_only_reminder_time) at time zone s.timezone
                      else a.starts_at - s.reminder_lead
                 end as remind_at
            from public.activities a
            join public.activity_recipients r on r.activity_id = a.id and r.notify_email
            left join public.profiles p on p.id = r.profile_id
            left join public.contacts c on c.id = r.contact_id
           where (p_activity_id is null or a.id = p_activity_id)
             and a.status = 'scheduled'
             and a.reminders_enabled
             and a.starts_at > p_now
             and coalesce(p.is_active, c.is_active)
             and coalesce(p.email::text, c.email::text) is not null) as t
   -- On time, or late with enough notice left; a job that is already waiting is kept up to date.
   where t.remind_at > p_now
      or t.starts_at - p_now >= s.reminder_min_notice
      or exists (select 1 from public.notification_jobs x where x.dedupe_key = t.dedupe_key and x.status = 'pending')
  on conflict (dedupe_key) do update
     set destination   = excluded.destination,
         scheduled_for = excluded.scheduled_for,
         -- Keep a retry's waiting time unless the reminder time itself changed.
         run_after     = case when j.status = 'cancelled' or j.scheduled_for is distinct from excluded.scheduled_for
                              then excluded.run_after else j.run_after end,
         expires_at    = excluded.expires_at,
         status        = 'pending',
         status_reason = case when j.status = 'cancelled' then null else j.status_reason end
   where (j.status = 'pending' or (j.status = 'cancelled' and j.status_reason is distinct from 'cancelled_by_admin'))
     and (j.status, j.destination, j.scheduled_for, j.expires_at)
         is distinct from ('pending'::public.job_status, excluded.destination, excluded.scheduled_for, excluded.expires_at);
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  return v_changed;
end;
$$;

-- Same as in 20261022090000_weekly_summary_queue.sql, except that a job cancelled by an
-- administrator is not revived.
create or replace function public.plan_weekly_summaries(p_now timestamptz default now())
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
     where (j.status = 'pending' or (j.status = 'cancelled' and j.status_reason is distinct from 'cancelled_by_admin'))
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

-- Cancels one waiting message (administrators only). The planners leave it cancelled.
create function public.cancel_notification_job(p_job_id uuid)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.notification_jobs;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can cancel messages' using errcode = '42501';
  end if;
  select * into j from public.notification_jobs where id = p_job_id for update;
  if not found then
    raise exception 'That message no longer exists' using errcode = 'P0002';
  end if;
  if j.status = 'processing' then
    raise exception 'This message is being sent right now, so it can no longer be cancelled' using errcode = '22023';
  end if;
  if j.status <> 'pending' then
    raise exception 'Only messages that are still waiting can be cancelled' using errcode = '22023';
  end if;

  update public.notification_jobs
     set status = 'cancelled', status_reason = 'cancelled_by_admin', lease_expires_at = null
   where id = j.id;
  insert into public.notification_logs (job_id, event, details)
  values (j.id, 'cancelled_by_admin', jsonb_build_object('by', auth.uid()));
  return 'cancelled'::public.job_status;
end;
$$;

-- Sends a failed message again, or undoes an administrator's cancel (administrators only), as
-- long as its deadline has not passed. It keeps its key and its stored content, so if an earlier
-- attempt did reach the provider within the last 24 hours, the provider does not send it twice.
-- Reminders are still checked against their activity before they go out.
create function public.retry_notification_job(p_job_id uuid)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  j         public.notification_jobs;
  v_restore boolean;
  v_run_at  timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can send messages again' using errcode = '42501';
  end if;
  select * into j from public.notification_jobs where id = p_job_id for update;
  if not found then
    raise exception 'That message no longer exists' using errcode = 'P0002';
  end if;
  v_restore := j.status = 'cancelled' and j.status_reason = 'cancelled_by_admin';
  if j.status <> 'failed' and not v_restore then
    raise exception 'Only failed messages, or messages an administrator cancelled, can be sent again' using errcode = '22023';
  end if;
  if j.expires_at is not null and j.expires_at <= now() then
    raise exception 'Too late: the deadline for this message has passed' using errcode = '22023';
  end if;
  if j.attempt_count >= 20 then
    raise exception 'This message has been tried too many times to try again' using errcode = '22023';
  end if;

  -- An undone cancel keeps its planned time; a failed message goes now.
  v_run_at := greatest(j.scheduled_for, now());
  update public.notification_jobs
     set status           = 'pending',
         status_reason    = case when v_restore then 'restored_by_admin' else 'resend_by_admin' end,
         run_after        = v_run_at,
         -- A few more attempts than it has had so far (the database allows 20 at most).
         max_attempts     = greatest(j.max_attempts, least(20, j.attempt_count + 3)),
         lease_expires_at = null
   where id = j.id;
  insert into public.notification_logs (job_id, event, details)
  values (j.id, case when v_restore then 'restored_by_admin' else 'resend_by_admin' end, jsonb_build_object('by', auth.uid()));

  if v_run_at <= now() then
    perform public.request_dispatch();
  end if;
  return 'pending'::public.job_status;
end;
$$;

revoke execute on function public.cancel_notification_job(uuid), public.retry_notification_job(uuid) from public, anon;
grant execute on function public.cancel_notification_job(uuid), public.retry_notification_job(uuid) to authenticated;
