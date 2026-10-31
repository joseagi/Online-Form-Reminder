-- Stage 6d: an email alert to administrators when messages need attention (ARCHITECTURE.md §7.5).
--
-- A problem is what the red badge counts (src/lib/admin/data.ts): a message that failed, or one
-- the provider accepted and later reported as bounced, complained, failed or suppressed, last
-- changed in the past 7 days. Each run of the dispatcher calls plan_failure_alerts(): when there
-- are problems not yet reported and no alert went out in the past 6 hours, it queues one alert per
-- active administrator, listing them. The alert is an ordinary message (kind 'failure_alert'), so
-- it has the same test-mode gate, idempotency key, retries and log as every other.
--
-- Each reported problem gets an 'included_in_alert' log entry, written at the alert's time (its
-- scheduled_for). A problem counts as new again when the message changes after that, e.g. it was
-- sent again and failed again, or a bounce was reported for it.
-- Alerts are never about alerts: a failed alert shows on the badge only, so a broken provider
-- cannot set off a chain of alerts about alerts.

create function public.plan_failure_alerts(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Overlapping dispatcher runs plan one after the other; the second then sees the first's alert.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.plan_failure_alerts'));

  -- At most one alert every 6 hours. (Only alerts up to p_now count, so a test can plan "as of"
  -- another time without the local database's own alerts getting in the way.)
  if exists (select 1 from public.notification_jobs
              where kind = 'failure_alert'
                and scheduled_for > p_now - interval '6 hours' and scheduled_for <= p_now) then
    return 0;
  end if;

  with problems as (
    select j.id
      from public.notification_jobs j
     where j.kind <> 'failure_alert'
       and (j.status = 'failed'
            or (j.status = 'sent' and j.delivery_status in ('bounced', 'complained', 'failed', 'suppressed')))
       and j.updated_at > p_now - interval '7 days' and j.updated_at <= p_now
       and not exists (select 1 from public.notification_logs l
                        where l.job_id = j.id and l.event = 'included_in_alert' and l.created_at >= j.updated_at)
  ), alerts as (
    insert into public.notification_jobs
      (kind, channel, dedupe_key, profile_id, destination, scheduled_for, run_after, expires_at)
    select 'failure_alert', 'email',
           'alert:email:' || floor(extract(epoch from p_now))::bigint || ':' || p.id,
           p.id, p.email, p_now, p_now, p_now + interval '24 hours'
      from public.profiles p
     where p.role = 'admin' and p.is_active
       and exists (select 1 from problems)
    on conflict (dedupe_key) do nothing
    returning id
  ), reported as (
    -- Only when an alert was queued: with no active administrator, the problems wait.
    insert into public.notification_logs (job_id, event, details, created_at)
    select pr.id, 'included_in_alert', jsonb_build_object('alert_at', p_now), p_now
      from problems pr
     where exists (select 1 from alerts)
  )
  select count(*) into v_count from alerts;
  return v_count;
end;
$$;

-- The problems an alert reports: those logged 'included_in_alert' at the alert's time.
create function public.failure_alert_items(p_job_id uuid)
returns table (
  job_id             uuid,
  kind               public.notification_kind,
  destination        text,
  scheduled_for      timestamptz,
  status             public.job_status,
  status_reason      text,
  delivery_status    public.delivery_status,
  last_error_code    text,
  last_error_message text,
  activity_title     text,
  period_start       date)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.kind, j.destination, j.scheduled_for, j.status, j.status_reason, j.delivery_status,
         j.last_error_code, j.last_error_message, a.title, j.period_start
    from public.notification_jobs alert
    join public.notification_logs l on l.event = 'included_in_alert' and l.created_at = alert.scheduled_for
    join public.notification_jobs j on j.id = l.job_id
    left join public.activities a on a.id = j.activity_id
   where alert.id = p_job_id and alert.kind = 'failure_alert'
   order by j.scheduled_for, j.id;
$$;

revoke execute on function
  public.plan_failure_alerts(timestamptz),
  public.failure_alert_items(uuid)
from public, anon, authenticated;

grant execute on function
  public.plan_failure_alerts(timestamptz),
  public.failure_alert_items(uuid)
to service_role;
