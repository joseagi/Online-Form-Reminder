-- The failure alert to administrators (stage 6d): which problems it reports, who receives it, at
-- most one every 6 hours, and a problem reported again only when the message changed since.
--
-- "B" is 20 hours before the test's clock (now()); alerts are planned "as of" times after it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Isolate from data already in the local database. Everything here is rolled back at the end.
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false;
alter table public.profiles enable trigger profiles_guard_update;
delete from public.notification_jobs;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'ada@example.com',  '{"full_name": "Ada Admin"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'cy@example.com',   '{"full_name": "Cy Former Admin"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'bayo@example.com', '{"full_name": "Bayo Staff"}');
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set role = 'admin' where id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2');
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000e2';
alter table public.profiles enable trigger profiles_guard_update;

-- No one is listed on it, so it plans no reminders of its own.
insert into public.activities (id, title, activity_date, start_time, timezone, created_by) values
  ('00000000-0000-4000-8000-0000000000b1', 'Board meeting', '2035-03-06', '10:00', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000e1');

create function pg_temp.at(p_offset text) returns timestamptz language sql as $$
  select now() - interval '20 hours' + p_offset::interval
$$;
create function pg_temp.alert_at(p_offset text) returns uuid language sql as $$
  select id from public.notification_jobs where kind = 'failure_alert' and scheduled_for = pg_temp.at(p_offset)
$$;
create function pg_temp.reported(p_job text) returns bigint language sql as $$
  select count(*) from public.notification_logs where job_id = p_job::uuid and event = 'included_in_alert'
$$;

insert into public.notification_jobs
  (id, kind, channel, dedupe_key, destination, activity_id, basis_starts_at, period_start, scheduled_for, run_after,
   status, status_reason, attempt_count, provider, provider_message_id, accepted_at, delivery_status, last_error_code, updated_at)
values
  -- Problems: refused by the provider, and accepted but then bounced.
  ('00000000-0000-4000-8000-0000000000f1', 'day_before_reminder', 'email', 'it-f1', 'bayo@example.com',
   '00000000-0000-4000-8000-0000000000b1', '2035-03-06 09:00+00', null, pg_temp.at('-2 hours'), pg_temp.at('-2 hours'),
   'failed', 'rejected', 1, 'resend', null, null, 'unknown', 'validation_error', pg_temp.at('-1 hour')),
  ('00000000-0000-4000-8000-0000000000f2', 'weekly_summary', 'email', 'it-f2', 'dee@example.com',
   null, null, '2035-03-05', pg_temp.at('-3 hours'), pg_temp.at('-3 hours'),
   'sent', null, 1, 'resend', 'msg-f2', pg_temp.at('-3 hours'), 'bounced', null, pg_temp.at('-1 hour')),
  -- Not problems: delivered, skipped, a week old, an alert itself, and one changed after "B".
  ('00000000-0000-4000-8000-0000000000f3', 'test', 'email', 'it-f3', 'ada@example.com',
   null, null, '2035-03-05', pg_temp.at('-4 hours'), pg_temp.at('-4 hours'),
   'sent', null, 1, 'resend', 'msg-f3', pg_temp.at('-4 hours'), 'delivered', null, pg_temp.at('-1 hour')),
  ('00000000-0000-4000-8000-0000000000f4', 'weekly_summary', 'email', 'it-f4', 'eke@example.com',
   null, null, '2035-03-05', pg_temp.at('-5 hours'), pg_temp.at('-5 hours'),
   'skipped', 'expired', 0, null, null, null, 'unknown', null, pg_temp.at('-1 hour')),
  ('00000000-0000-4000-8000-0000000000f5', 'weekly_summary', 'email', 'it-f5', 'fola@example.com',
   null, null, '2035-03-05', pg_temp.at('-8 days'), pg_temp.at('-8 days'),
   'failed', 'rejected', 1, 'resend', null, null, 'unknown', 'validation_error', pg_temp.at('-8 days')),
  ('00000000-0000-4000-8000-0000000000f6', 'failure_alert', 'email', 'it-f6', 'ada@example.com',
   null, null, null, pg_temp.at('-7 hours'), pg_temp.at('-7 hours'),
   'failed', 'retries_exhausted', 6, 'resend', null, null, 'unknown', 'service_unavailable', pg_temp.at('-1 hour')),
  ('00000000-0000-4000-8000-0000000000f7', 'test', 'email', 'it-f7', 'gbenga@example.com',
   null, null, '2035-03-05', pg_temp.at('-1 hour'), pg_temp.at('-1 hour'),
   'failed', 'outcome_unknown', 1, 'resend', null, null, 'unknown', null, pg_temp.at('30 minutes'));

-- The first alert --------------------------------------------------------------------------------
select is(public.plan_failure_alerts(pg_temp.at('0')), 1, 'problems: one alert, for the one active administrator');
select results_eq(
  $$ select destination::text, profile_id, run_after, expires_at, status::text, attempt_count
       from public.notification_jobs where kind = 'failure_alert' and scheduled_for = pg_temp.at('0') $$,
  $$ values ('ada@example.com', '00000000-0000-4000-8000-0000000000e1'::uuid, pg_temp.at('0'), pg_temp.at('24 hours'), 'pending', 0) $$,
  'it goes to the active administrator now, may be sent for 24 hours, and not to a former administrator or to staff');
select matches((select dedupe_key from public.notification_jobs where id = pg_temp.alert_at('0')),
               '^alert:email:[0-9]+:00000000-0000-4000-8000-0000000000e1$', 'its key names the alert time and the administrator');
select set_eq(
  $$ select job_id from public.notification_logs where event = 'included_in_alert' $$,
  array['00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2']::uuid[],
  'it reports the refused and the bounced message; not delivered, skipped, week-old or later ones, nor a failed alert');
select results_eq(
  $$ select job_id, kind::text, activity_title, status_reason, last_error_code
       from public.failure_alert_items(pg_temp.alert_at('0')) $$,
  $$ values ('00000000-0000-4000-8000-0000000000f2'::uuid, 'weekly_summary', null::text, null::text, null::text),
            ('00000000-0000-4000-8000-0000000000f1'::uuid, 'day_before_reminder', 'Board meeting', 'rejected', 'validation_error') $$,
  'failure_alert_items lists them, earliest due first, with what the email needs to say');
select is_empty($$ select * from public.failure_alert_items('00000000-0000-4000-8000-0000000000f1') $$,
                'failure_alert_items gives nothing for a message that is not an alert');

-- At most one every 6 hours ------------------------------------------------------------------------
select is(public.plan_failure_alerts(pg_temp.at('5 hours 59 minutes')), 0, 'within 6 hours: no second alert, though there is a new problem');
select is(pg_temp.reported('00000000-0000-4000-8000-0000000000f7'), 0::bigint, '... and the new problem waits, unreported');
select is(public.plan_failure_alerts(pg_temp.at('6 hours')), 1, '6 hours later: a second alert');
select results_eq($$ select job_id from public.failure_alert_items(pg_temp.alert_at('6 hours')) $$,
                  array['00000000-0000-4000-8000-0000000000f7']::uuid[], '... with only the new problem in it');
select is(public.plan_failure_alerts(pg_temp.at('12 hours')), 0, 'nothing new: no alert');
select is((select count(*) from public.notification_jobs where kind = 'failure_alert'), 3::bigint, '... (still only the two alerts, and the old failed one)');
select is(public.plan_failure_alerts(pg_temp.at('12 hours')), 0, 'planning again changes nothing');

-- Reported again when the message changed ----------------------------------------------------------
-- The refused reminder is sent again and fails again; the delivered test message bounces late.
update public.notification_jobs set status = 'pending', status_reason = null where id = '00000000-0000-4000-8000-0000000000f1';
update public.notification_jobs set status = 'failed', status_reason = 'rejected' where id = '00000000-0000-4000-8000-0000000000f1';
select is(public.record_delivery_event('resend', 'evt-it-f3', 'email.bounced', 'msg-f3'), 'recorded', 'a late bounce is recorded');
select is(public.plan_failure_alerts(pg_temp.at('20 hours')), 1, 'a message that failed again, and a late bounce, set off a new alert');
select set_eq($$ select job_id from public.failure_alert_items(pg_temp.alert_at('20 hours')) $$,
              array['00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f3']::uuid[],
              '... reporting just those two again');

-- Nobody to tell ---------------------------------------------------------------------------------
insert into public.notification_jobs
  (id, kind, channel, dedupe_key, destination, period_start, scheduled_for, run_after, status, status_reason, attempt_count)
values
  ('00000000-0000-4000-8000-0000000000f8', 'test', 'email', 'it-f8', 'ada@example.com', '2035-03-05', now(), now(), 'failed', 'rejected', 1);
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000e1';
alter table public.profiles enable trigger profiles_guard_update;
select is(public.plan_failure_alerts(pg_temp.at('27 hours')), 0, 'no active administrator: no alert');
select is(pg_temp.reported('00000000-0000-4000-8000-0000000000f8'), 0::bigint, '... and the problem waits for one');
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = true where id = '00000000-0000-4000-8000-0000000000e1';
alter table public.profiles enable trigger profiles_guard_update;
select results_eq($$ select public.plan_failure_alerts(pg_temp.at('27 hours 1 minute')) $$, array[1],
                  'once there is one, it is told');

-- Who can call them --------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.plan_failure_alerts(timestamptz)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.plan_failure_alerts(timestamptz)', 'EXECUTE'),
          'signed-in users and visitors cannot plan alerts');
select ok(not has_function_privilege('authenticated', 'public.failure_alert_items(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.failure_alert_items(uuid)', 'EXECUTE'),
          'signed-in users and visitors cannot read alert contents through the API');
select ok(has_function_privilege('service_role', 'public.plan_failure_alerts(timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.failure_alert_items(uuid)', 'EXECUTE'),
          'the dispatcher (service role) can call both');

select * from finish();
rollback;
