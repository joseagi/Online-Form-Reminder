-- Phase 5a: day-before reminders.
--
-- Each person listed on a scheduled activity (with email notifications on, active, and with an
-- email address) gets one reminder job per start time:
--   * timed activity:     reminder_lead before the start (default 24 hours)
--   * date-only activity: date_only_reminder_time on the day before (default 09:00, office time)
--   * never after the activity has started (expires_at = starts_at)
--   * created too late for that: sent at once if at least reminder_min_notice (default 2 hours)
--     is left before the start, otherwise not at all.
-- Jobs follow the activity: they are synced at the end of every transaction that changes it or
-- its people, and again by the 5-minute schedule (which also catches settings changes and
-- deactivated people). The dispatcher re-checks each job right before sending.

-- Why a reminder job should no longer be sent, or null if it still should.
create function public.reminder_job_problem(p_job public.notification_jobs, p_now timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when a.id is null                         then 'activity_missing'
           when a.status = 'cancelled'               then 'activity_cancelled'
           when a.status = 'completed'               then 'activity_completed'
           when not a.reminders_enabled              then 'reminders_off'
           when a.starts_at <> p_job.basis_starts_at then 'rescheduled'
           when a.starts_at <= p_now                 then 'expired'
           when r.id is null or not r.notify_email   then 'recipient_removed'
           when not coalesce(p.is_active, c.is_active, false)
                or coalesce(p.email::text, c.email::text) is null then 'recipient_inactive'
         end
    from (select 1) as one
    left join public.activities a on a.id = p_job.activity_id
    left join public.activity_recipients r
           on r.activity_id = p_job.activity_id
          and (r.profile_id = p_job.profile_id or r.contact_id = p_job.contact_id)
    left join public.profiles p on p.id = p_job.profile_id
    left join public.contacts c on c.id = p_job.contact_id;
$$;

-- Brings reminder jobs in line with one activity (p_activity_id) or all of them (null).
-- Safe to run as often as you like. Returns how many jobs it created or changed.
--   * A new start time is a new job (the start is part of the key): the old one is cancelled
--     as 'rescheduled', and revived if the activity moves back. A sent job is never sent again.
--   * Content-only edits change nothing: the message is written when it is sent.
--   * Jobs for activities that have already started are left to the dispatcher, which closes
--     them as expired.
create function public.sync_reminders(p_activity_id uuid default null, p_now timestamptz default now())
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
   where j.status in ('pending', 'cancelled')
     and (j.status, j.destination, j.scheduled_for, j.expires_at)
         is distinct from ('pending'::public.job_status, excluded.destination, excluded.scheduled_for, excluded.expires_at);
  get diagnostics v_count = row_count;
  v_changed := v_changed + v_count;

  return v_changed;
end;
$$;

-- Everything the schedule plans: weekly summaries and reminders.
create function public.plan_notifications(p_now timestamptz default now())
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.plan_weekly_summaries(p_now) + public.sync_reminders(null, p_now);
$$;

-- Keeps reminders in step with activities and their people. Deferred to the end of the
-- transaction, so an activity saved together with its people is synced once, in its final state
-- (not after each intermediate step of the save).
create function public.sync_reminders_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'activities' then
    perform public.sync_reminders(new.id);
  elsif tg_op = 'DELETE' then
    perform public.sync_reminders(old.activity_id);
  else
    perform public.sync_reminders(new.activity_id);
  end if;
  return null;
end;
$$;

create constraint trigger activities_sync_reminders
  after update on public.activities
  deferrable initially deferred
  for each row
  when (old.starts_at is distinct from new.starts_at
        or old.status is distinct from new.status
        or old.reminders_enabled is distinct from new.reminders_enabled)
  execute function public.sync_reminders_after_change();

create constraint trigger activity_recipients_sync_reminders
  after insert or delete on public.activity_recipients
  deferrable initially deferred
  for each row
  execute function public.sync_reminders_after_change();

create constraint trigger activity_recipients_sync_reminders_on_update
  after update on public.activity_recipients
  deferrable initially deferred
  for each row
  when (old.notify_email is distinct from new.notify_email)
  execute function public.sync_reminders_after_change();

-- What the dispatcher needs to write one reminder, and whether it should still be sent
-- (problem is null) — checked again on every attempt.
create function public.reminder_details(p_job_id uuid, p_now timestamptz default now())
returns table (
  problem            text,
  activity_id        uuid,
  title              text,
  description        text,
  activity_date      date,
  start_time         time,
  end_time           time,
  timezone           text,
  location           text,
  meeting_url        text,
  contact_name       text,
  contact_phone      text,
  contact_email      text,
  preparation_notes  text,
  recipient_name     text,
  recipient_role     public.recipient_role,
  recipient_is_staff boolean,
  responsible_name   text,
  others             text[]   -- collaborators other than the recipient
)
language sql
stable
security definer
set search_path = ''
as $$
  select public.reminder_job_problem(j, p_now),
         a.id, a.title, a.description, a.activity_date, a.start_time, a.end_time, a.timezone,
         a.location, a.meeting_url, a.contact_name, a.contact_phone, a.contact_email::text, a.preparation_notes,
         coalesce(p.full_name, c.full_name), r.role, j.profile_id is not null,
         (select rp.full_name
            from public.activity_recipients rr
            join public.profiles rp on rp.id = rr.profile_id
           where rr.activity_id = a.id and rr.role = 'responsible'),
         coalesce((select array_agg(coalesce(op.full_name, oc.full_name) order by coalesce(op.full_name, oc.full_name))
                     from public.activity_recipients o
                     left join public.profiles op on op.id = o.profile_id
                     left join public.contacts oc on oc.id = o.contact_id
                    where o.activity_id = a.id
                      and o.role = 'collaborator'
                      and not (o.profile_id is not distinct from j.profile_id
                               and o.contact_id is not distinct from j.contact_id)), '{}')
    from public.notification_jobs j
    left join public.activities a on a.id = j.activity_id
    left join public.activity_recipients r
           on r.activity_id = j.activity_id
          and (r.profile_id = j.profile_id or r.contact_id = j.contact_id)
    left join public.profiles p on p.id = j.profile_id
    left join public.contacts c on c.id = j.contact_id
   where j.id = p_job_id
     and j.kind = 'day_before_reminder';
$$;

revoke execute on function
  public.reminder_job_problem(public.notification_jobs, timestamptz),
  public.sync_reminders(uuid, timestamptz),
  public.plan_notifications(timestamptz),
  public.reminder_details(uuid, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.reminder_job_problem(public.notification_jobs, timestamptz),
  public.sync_reminders(uuid, timestamptz),
  public.plan_notifications(timestamptz),
  public.reminder_details(uuid, timestamptz)
to service_role;

revoke execute on function public.sync_reminders_after_change() from public, anon, authenticated;

-- The schedule now plans reminders as well as summaries.
select cron.schedule(
  'dispatch-notifications',
  '*/5 * * * *',
  $job$
    select public.plan_notifications();
    select public.request_dispatch();
  $job$
);
