-- Administrators cancel a waiting message, send a failed one again, or undo their own cancel; the
-- planners never undo an administrator's cancel.
--
-- Activities are in 2035, so the real clock is well before their reminder times. The sync runs at
-- the end of each transaction; tests never commit, so "flush" makes it run (see test 11):
--   set constraints all immediate; set constraints all deferred;
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Isolate from data already in the local database. Everything here is rolled back at the end.
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false;
alter table public.profiles enable trigger profiles_guard_update;
update public.contacts set is_active = false;
delete from public.notification_jobs;
delete from public.activities;
update public.system_settings
   set timezone = 'Africa/Lagos', reminder_lead = '24 hours', date_only_reminder_time = '09:00',
       reminder_min_notice = '2 hours', weekly_summary_enabled = true, weekly_summary_send_time = '17:00',
       weekly_summary_late_cutoff = '16 hours';
set constraints all immediate; set constraints all deferred;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'ada@example.com',  '{"full_name": "Ada Admin"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'bayo@example.com', '{"full_name": "Bayo Staff"}');
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000d1';
update public.profiles set receives_weekly_summary = false where id = '00000000-0000-4000-8000-0000000000d2';
alter table public.profiles enable trigger profiles_guard_update;

-- Tuesday 6 March 2035, 10:00 Lagos; Bayo is reminded.
insert into public.activities (id, title, activity_date, start_time, timezone, created_by) values
  ('00000000-0000-4000-8000-0000000000b1', 'Board meeting', '2035-03-06', '10:00', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000d1');
insert into public.activity_recipients (activity_id, profile_id, role, notify_email) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d2', 'responsible', true);
set constraints all immediate; set constraints all deferred;

create function pg_temp.reminder(p_start text) returns public.notification_jobs language sql as $$
  select * from public.notification_jobs
   where activity_id = '00000000-0000-4000-8000-0000000000b1' and basis_starts_at = p_start::timestamptz
$$;
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', p_id), true);
$$;
-- New functions are closed to the API roles by default (see 14_privileges); this helper is
-- called while acting as a signed-in user.
grant execute on function pg_temp.as_user(text) to authenticated;
select set_config('tests.reminder', (pg_temp.reminder('2035-03-06 09:00+00')).id::text, true);

-- Cancelling a reminder -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d2');
select throws_ok(format($$ select public.cancel_notification_job('%s') $$, current_setting('tests.reminder')),
                 '42501', 'Only administrators can cancel messages', 'staff cannot cancel messages');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000d1');
select is(public.cancel_notification_job(current_setting('tests.reminder')::uuid), 'cancelled'::public.job_status,
          'an administrator cancels a waiting reminder');
reset role;
select results_eq(
  $$ select status::text, status_reason from pg_temp.reminder('2035-03-06 09:00+00') $$,
  $$ values ('cancelled', 'cancelled_by_admin') $$,
  'it is marked as cancelled by an administrator');
select results_eq(
  format($$ select event, details->>'by' from public.notification_logs where job_id = '%s' $$, current_setting('tests.reminder')),
  $$ values ('cancelled_by_admin', '00000000-0000-4000-8000-0000000000d1') $$,
  'its history says who cancelled it');

select public.sync_reminders();
select is((pg_temp.reminder('2035-03-06 09:00+00')).status_reason, 'cancelled_by_admin',
          'the 5-minute planner does not bring it back');
update public.activities set description = 'Bring the budget' where id = '00000000-0000-4000-8000-0000000000b1';
set constraints all immediate; set constraints all deferred;
select is((pg_temp.reminder('2035-03-06 09:00+00')).status_reason, 'cancelled_by_admin',
          'nor does editing the activity');

-- A new start time is a new reminder; moving back to the cancelled time does not revive it.
update public.activities set start_time = '11:00' where id = '00000000-0000-4000-8000-0000000000b1';
set constraints all immediate; set constraints all deferred;
select is((pg_temp.reminder('2035-03-06 10:00+00')).status::text, 'pending',
          'when the activity moves, the new time gets its own reminder');
update public.activities set start_time = '10:00' where id = '00000000-0000-4000-8000-0000000000b1';
set constraints all immediate; set constraints all deferred;
select results_eq(
  $$ select (pg_temp.reminder('2035-03-06 09:00+00')).status_reason, (pg_temp.reminder('2035-03-06 10:00+00')).status_reason $$,
  $$ values ('cancelled_by_admin', 'rescheduled') $$,
  'moving back to the cancelled time leaves that reminder cancelled');

-- Undoing the cancel ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d1');
select is(public.retry_notification_job(current_setting('tests.reminder')::uuid), 'pending'::public.job_status,
          'an administrator can undo their cancel');
reset role;
select results_eq(
  $$ select status::text, status_reason, run_after from pg_temp.reminder('2035-03-06 09:00+00') $$,
  $$ values ('pending', 'restored_by_admin', '2035-03-05 09:00+00'::timestamptz) $$,
  'it waits for its planned time again');
select public.sync_reminders();
select is((pg_temp.reminder('2035-03-06 09:00+00')).status::text, 'pending', 'and the planner keeps it');

-- Weekly summaries ------------------------------------------------------------------------------
select public.plan_weekly_summaries('2035-02-28 12:00+01');
select set_config('tests.summary', (select id::text from public.notification_jobs
                                     where kind = 'weekly_summary' and period_start = '2035-03-05'), true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d1');
select public.cancel_notification_job(current_setting('tests.summary')::uuid);
reset role;
select public.plan_weekly_summaries('2035-02-28 12:05+01');
select results_eq(
  format($$ select status::text, status_reason from public.notification_jobs where id = '%s' $$, current_setting('tests.summary')),
  $$ values ('cancelled', 'cancelled_by_admin') $$,
  'the summary planner does not bring back a cancelled summary either');
update public.system_settings set weekly_summary_send_time = '18:00';
select public.plan_weekly_summaries('2035-02-28 12:10+01');
select is((select status_reason from public.notification_jobs where id = current_setting('tests.summary')::uuid),
          'cancelled_by_admin', 'even when the send time changes');

-- Messages that cannot be cancelled -------------------------------------------------------------
insert into public.notification_jobs
  (id, kind, channel, dedupe_key, destination, scheduled_for, run_after, expires_at, status, status_reason,
   attempt_count, first_attempt_at, lease_expires_at, provider, provider_message_id, accepted_at)
values
  ('00000000-0000-4000-8000-0000000000f1', 'test', 'email', 'test:email:f1', 'ada@example.com',
   now() - interval '1 hour', now() - interval '1 hour', now() + interval '1 hour', 'sent', null,
   1, now() - interval '1 hour', null, 'resend', 'em-f1', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000f2', 'test', 'email', 'test:email:f2', 'ada@example.com',
   now(), now(), now() + interval '1 hour', 'processing', null,
   1, now(), now() + interval '5 minutes', null, null, null),
  -- Failed after all 6 attempts, deadline still ahead.
  ('00000000-0000-4000-8000-0000000000f3', 'test', 'email', 'test:email:f3', 'ada@example.com',
   now() - interval '2 hours', now() - interval '2 hours', now() + interval '1 hour', 'failed', 'retries_exhausted',
   6, now() - interval '2 hours', null, 'resend', null, null),
  -- Failed, deadline passed.
  ('00000000-0000-4000-8000-0000000000f4', 'test', 'email', 'test:email:f4', 'ada@example.com',
   now() - interval '3 hours', now() - interval '3 hours', now() - interval '1 minute', 'failed', 'rejected',
   1, now() - interval '3 hours', null, 'resend', null, null);

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d1');
select throws_ok($$ select public.cancel_notification_job('00000000-0000-4000-8000-0000000000f1') $$,
                 '22023', 'Only messages that are still waiting can be cancelled', 'a sent message cannot be cancelled');
select throws_ok($$ select public.cancel_notification_job('00000000-0000-4000-8000-0000000000f2') $$,
                 '22023', 'This message is being sent right now, so it can no longer be cancelled',
                 'nor can one that is being sent');
select throws_ok($$ select public.cancel_notification_job('00000000-0000-4000-8000-0000000000ff') $$,
                 'P0002', 'That message no longer exists', 'a missing message is reported');

-- Sending a failed message again ----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d2');
select throws_ok($$ select public.retry_notification_job('00000000-0000-4000-8000-0000000000f3') $$,
                 '42501', 'Only administrators can send messages again', 'staff cannot send messages again');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d1');
select is(public.retry_notification_job('00000000-0000-4000-8000-0000000000f3'), 'pending'::public.job_status,
          'an administrator sends a failed message again');
reset role;
select results_eq(
  $$ select status::text, status_reason, run_after <= now(), max_attempts, attempt_count
       from public.notification_jobs where id = '00000000-0000-4000-8000-0000000000f3' $$,
  $$ values ('pending', 'resend_by_admin', true, 9, 6) $$,
  'it is due now, with three more attempts than it had (its earlier attempts still count)');
select is((select attempt_count from public.claim_notification_jobs(gen_random_uuid(), 50)
            where id = '00000000-0000-4000-8000-0000000000f3'), 7,
          'the dispatcher can pick it up again');
select ok(exists (select 1 from public.notification_logs
                   where job_id = '00000000-0000-4000-8000-0000000000f3' and event = 'resend_by_admin'
                     and details->>'by' = '00000000-0000-4000-8000-0000000000d1'),
          'its history says who sent it again');

set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d1');
select throws_ok($$ select public.retry_notification_job('00000000-0000-4000-8000-0000000000f4') $$,
                 '22023', 'Too late: the deadline for this message has passed', 'not after its deadline');
select throws_ok($$ select public.retry_notification_job('00000000-0000-4000-8000-0000000000f1') $$,
                 '22023', 'Only failed messages, or messages an administrator cancelled, can be sent again',
                 'a sent message is not sent again');
reset role;

select ok(not has_function_privilege('anon', 'public.retry_notification_job(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.cancel_notification_job(uuid)', 'EXECUTE'),
          'anonymous visitors cannot call either');

select * from finish();
rollback;
