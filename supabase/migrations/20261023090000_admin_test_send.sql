-- Phase 4c: "Send test to me" for administrators, and an on-demand dispatcher run.

-- Asks the dispatcher to run now (used by the schedule and by test sends). pg_net sends the request
-- in the background after the calling transaction commits. Returns the pg_net request id, or null
-- if the dispatcher has not been configured (see public.configure_dispatch).
create function public.request_dispatch()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'dispatch_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end;
$$;

revoke execute on function public.request_dispatch() from public, anon, authenticated;
grant execute on function public.request_dispatch() to service_role;

-- Same schedule as before, now through request_dispatch().
select cron.schedule(
  'dispatch-notifications',
  '*/5 * * * *',
  $job$
    select public.plan_weekly_summaries();
    select public.request_dispatch();
  $job$
);

-- Queues a test copy of the coming week's summary to the calling administrator's own address and
-- runs the dispatcher straight away. Test messages always go to the requester (never to anyone
-- else) and are marked as tests. At most 5 per administrator per hour.
create function public.queue_test_notification()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_today   date;
  v_id      uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can send test messages' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = auth.uid();

  if (select count(*) from public.notification_jobs
       where kind = 'test' and profile_id = v_profile.id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You have sent 5 test messages in the last hour. Please try again later.' using errcode = '22023';
  end if;

  -- The Monday after the coming Sunday: the week the next summary will cover.
  select (now() at time zone s.timezone)::date into v_today from public.system_settings s;

  insert into public.notification_jobs
    (kind, channel, dedupe_key, profile_id, destination, period_start, scheduled_for, run_after, expires_at)
  values
    ('test', 'email', 'test:email:' || gen_random_uuid(), v_profile.id, v_profile.email,
     v_today + (8 - extract(isodow from v_today)::integer), now(), now(), now() + interval '1 hour')
  returning id into v_id;

  perform public.request_dispatch();
  return v_id;
end;
$$;

revoke execute on function public.queue_test_notification() from public, anon;
grant execute on function public.queue_test_notification() to authenticated;
