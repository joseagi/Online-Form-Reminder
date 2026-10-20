-- Day-before reminders: planning, following activity changes, and the details the dispatcher
-- re-checks before sending.
--
-- Office: Africa/Lagos (UTC+1, no daylight saving). Activities are in 2035, so the real clock
-- (used by the end-of-transaction sync) is always well before their reminder times; moments that
-- matter are simulated with p_now.
--
-- The sync runs at the end of each transaction. Tests never commit, so "flush" below makes the
-- waiting syncs run at that point, as a commit would:
--   set constraints all immediate; set constraints all deferred;
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Isolate from data already in the local database. Everything here is rolled back at the end.
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false;
alter table public.profiles enable trigger profiles_guard_update;
update public.contacts set is_active = false;
delete from public.notification_jobs;
delete from public.activities;
update public.system_settings
   set timezone = 'Africa/Lagos', reminder_lead = '24 hours', date_only_reminder_time = '09:00',
       reminder_min_notice = '2 hours', weekly_summary_enabled = false;
set constraints all immediate; set constraints all deferred;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e1', 'ada@example.com',   '{"full_name": "Ada Admin"}'),
  ('00000000-0000-4000-8000-0000000000e2', 'bayo@example.com',  '{"full_name": "Bayo Staff"}'),
  ('00000000-0000-4000-8000-0000000000e3', 'chika@example.com', '{"full_name": "Chika Staff"}'),
  ('00000000-0000-4000-8000-0000000000e4', 'dele@example.com',  '{"full_name": "Dele Staff"}');
insert into public.contacts (id, full_name, email, phone, created_by) values
  ('00000000-0000-4000-8000-000000000c01', 'Partner Contact', 'partner@org.example', null, '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-000000000c02', 'Phone Only', null, '+2348012345678', '00000000-0000-4000-8000-0000000000e1');

-- A1: Tuesday 6 March 2035, 10:00 Lagos (09:00 UTC). A2: all day Wednesday 7 March 2035.
insert into public.activities (id, title, activity_date, start_time, timezone, created_by) values
  ('00000000-0000-4000-8000-0000000000a1', 'Board meeting',   '2035-03-06', '10:00', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000a2', 'Report deadline', '2035-03-07', null,    'Africa/Lagos', '00000000-0000-4000-8000-0000000000e1');
insert into public.activity_recipients (activity_id, profile_id, contact_id, role, notify_email) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', null, 'responsible',  true),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e2', null, 'collaborator', true),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e3', null, 'collaborator', false),
  ('00000000-0000-4000-8000-0000000000a1', null, '00000000-0000-4000-8000-000000000c01', 'collaborator', true),
  ('00000000-0000-4000-8000-0000000000a1', null, '00000000-0000-4000-8000-000000000c02', 'notify_only',  true),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000e1', null, 'responsible',  true);
set constraints all immediate; set constraints all deferred;

-- Planning ----------------------------------------------------------------------------------
select set_eq(
  $$ select destination from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a1' $$,
  array['ada@example.com', 'bayo@example.com', 'partner@org.example'],
  'saving an activity plans a reminder for each listed person with email reminders on and an email address');
select results_eq(
  $$ select distinct scheduled_for, run_after, expires_at, basis_starts_at, status::text
       from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a1' $$,
  $$ values ('2035-03-05 09:00+00'::timestamptz, '2035-03-05 09:00+00'::timestamptz,
             '2035-03-06 09:00+00'::timestamptz, '2035-03-06 09:00+00'::timestamptz, 'pending') $$,
  'a timed activity is reminded 24 hours before, and never after it has started');
select is((select scheduled_for from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a2'),
          '2035-03-06 08:00+00'::timestamptz, 'an all-day activity is reminded at 09:00 office time on the day before');
select is((select dedupe_key from public.notification_jobs
            where activity_id = '00000000-0000-4000-8000-0000000000a1' and profile_id = '00000000-0000-4000-8000-0000000000e1'),
          'rem:email:00000000-0000-4000-8000-0000000000a1:p:00000000-0000-4000-8000-0000000000e1:'
            || extract(epoch from '2035-03-06 09:00+00'::timestamptz)::bigint,
          'one job per person per start time (the key is also the email provider''s idempotency key)');
select is(public.plan_notifications(), 0, 'the 5-minute schedule then finds nothing to change (no duplicates)');

create temp table original_jobs as
  select id from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a1';

update public.activities set title = 'Board meeting (agenda attached)', preparation_notes = 'Read the pack'
 where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select set_eq(
  $$ select id from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a1' and status = 'pending' $$,
  $$ select id from original_jobs $$,
  'editing the details leaves the reminders alone (the message is written when it is sent)');

-- Rescheduling ---------------------------------------------------------------------------------
update public.activities set start_time = '11:00' where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select results_eq(
  $$ select status::text, status_reason, count(*)::int, min(scheduled_for)
       from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a1'
      group by 1, 2 order by 1 $$,
  $$ values ('cancelled', 'rescheduled', 3, '2035-03-05 09:00+00'::timestamptz),
            ('pending',   null,          3, '2035-03-05 10:00+00'::timestamptz) $$,
  'moving the activity cancels the old reminders and plans new ones for the new time');

update public.activities set start_time = '10:00' where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select set_eq(
  $$ select id from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a1' and status = 'pending' $$,
  $$ select id from original_jobs $$,
  'moving it back revives the original reminders');
select is((select count(*)::int from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a1'),
          6, 'still one job per person per start time');

-- Ada's reminder for 10:00 goes out; the activity then moves to 11:00 and back again.
update public.notification_jobs
   set status = 'sent', accepted_at = now(), provider = 'log', provider_message_id = 'log:ada-10'
 where activity_id = '00000000-0000-4000-8000-0000000000a1' and profile_id = '00000000-0000-4000-8000-0000000000e1'
   and basis_starts_at = '2035-03-06 09:00+00';
update public.activities set start_time = '11:00' where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
update public.activities set start_time = '10:00' where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select results_eq(
  $$ select basis_starts_at, status::text from public.notification_jobs
      where activity_id = '00000000-0000-4000-8000-0000000000a1' and profile_id = '00000000-0000-4000-8000-0000000000e1'
      order by 1 $$,
  $$ values ('2035-03-06 09:00+00'::timestamptz, 'sent'), ('2035-03-06 10:00+00'::timestamptz, 'cancelled') $$,
  'a reminder that was already sent is never sent again');

-- One save that moves the activity to 12:00, removes Partner and adds Dele.
update public.activities set start_time = '12:00' where id = '00000000-0000-4000-8000-0000000000a1';
delete from public.activity_recipients
 where activity_id = '00000000-0000-4000-8000-0000000000a1' and contact_id = '00000000-0000-4000-8000-000000000c01';
insert into public.activity_recipients (activity_id, profile_id, role)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e4', 'collaborator');
set constraints all immediate; set constraints all deferred;
select set_eq(
  $$ select destination from public.notification_jobs
      where activity_id = '00000000-0000-4000-8000-0000000000a1' and status = 'pending' $$,
  array['ada@example.com', 'bayo@example.com', 'dele@example.com'],
  'after a save that changes the time and the people, exactly the people now listed have a reminder');
select is((select count(*)::int from public.notification_jobs
            where contact_id = '00000000-0000-4000-8000-000000000c01' and basis_starts_at = '2035-03-06 11:00+00'),
          0, 'the save is synced once, in its final state: nothing is planned for someone removed in the same save');
select is((select status_reason from public.notification_jobs
            where contact_id = '00000000-0000-4000-8000-000000000c01' and basis_starts_at = '2035-03-06 09:00+00'),
          'rescheduled', 'the removed person''s earlier reminder stays cancelled');

-- Switching reminders off and on, cancelling, completing, reopening -----------------------------
update public.activities set reminders_enabled = false where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select results_eq(
  $$ select distinct status::text, status_reason from public.notification_jobs
      where activity_id = '00000000-0000-4000-8000-0000000000a1' and basis_starts_at = '2035-03-06 11:00+00' $$,
  $$ values ('cancelled', 'reminders_off') $$,
  'turning reminders off for the activity cancels them');
update public.activities set reminders_enabled = true where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from public.notification_jobs
            where activity_id = '00000000-0000-4000-8000-0000000000a1' and status = 'pending'),
          3, 'turning them back on restores them');

update public.activities set status = 'cancelled', status_reason = 'Postponed' where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select results_eq(
  $$ select distinct status::text, status_reason from public.notification_jobs
      where activity_id = '00000000-0000-4000-8000-0000000000a1' and basis_starts_at = '2035-03-06 11:00+00' $$,
  $$ values ('cancelled', 'activity_cancelled') $$,
  'cancelling the activity cancels its reminders');
update public.activities set status = 'scheduled', status_reason = null where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select is((select count(*)::int from public.notification_jobs
            where activity_id = '00000000-0000-4000-8000-0000000000a1' and status = 'pending'),
          3, 'reopening it restores them');
update public.activities set status = 'completed' where id = '00000000-0000-4000-8000-0000000000a2';
set constraints all immediate; set constraints all deferred;
select is((select status_reason from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a2'),
          'activity_completed', 'completing an activity early cancels its reminder');

-- What the dispatcher is given ------------------------------------------------------------------
select set_config('tests.ada_job', (select id::text from public.notification_jobs
  where activity_id = '00000000-0000-4000-8000-0000000000a1' and profile_id = '00000000-0000-4000-8000-0000000000e1'
    and status = 'pending'), true);
select set_config('tests.dele_job', (select id::text from public.notification_jobs
  where activity_id = '00000000-0000-4000-8000-0000000000a1' and profile_id = '00000000-0000-4000-8000-0000000000e4'
    and status = 'pending'), true);
select results_eq(
  format($$ select problem, title, recipient_name, recipient_role::text, recipient_is_staff, responsible_name, others
              from public.reminder_details('%s') $$, current_setting('tests.ada_job')),
  $$ values (null::text, 'Board meeting (agenda attached)', 'Ada Admin', 'responsible', true, 'Ada Admin',
             array['Bayo Staff', 'Chika Staff', 'Dele Staff']) $$,
  'the dispatcher gets the current details, the person''s role, and who else is involved');
select results_eq(
  format($$ select recipient_role::text, others from public.reminder_details('%s') $$, current_setting('tests.dele_job')),
  $$ values ('collaborator', array['Bayo Staff', 'Chika Staff']) $$,
  'a collaborator''s reminder lists the other collaborators, not themselves');

-- Someone stops wanting email reminders; someone leaves.
update public.activity_recipients set notify_email = false
 where activity_id = '00000000-0000-4000-8000-0000000000a1' and profile_id = '00000000-0000-4000-8000-0000000000e2';
set constraints all immediate; set constraints all deferred;
select is((select status_reason from public.notification_jobs
            where activity_id = '00000000-0000-4000-8000-0000000000a1' and profile_id = '00000000-0000-4000-8000-0000000000e2'
              and basis_starts_at = '2035-03-06 11:00+00'),
          'recipient_removed', 'turning off email reminders for one person cancels theirs');

alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000e4';
alter table public.profiles enable trigger profiles_guard_update;
select is(public.plan_notifications(), 1, 'the 5-minute schedule notices that someone has left');
select is((select status_reason from public.notification_jobs where id = current_setting('tests.dele_job')::uuid),
          'recipient_inactive', 'and cancels their reminder');

-- Checked again at sending time -----------------------------------------------------------------
select is((select count(*)::int from public.claim_notification_jobs(gen_random_uuid(), 25, '2035-03-05 11:00+00')
            where id = current_setting('tests.ada_job')::uuid),
          1, 'Ada''s reminder is handed to the dispatcher when due');
update public.activities set status = 'cancelled', status_reason = 'Room unavailable' where id = '00000000-0000-4000-8000-0000000000a1';
set constraints all immediate; set constraints all deferred;
select is((select status::text from public.notification_jobs where id = current_setting('tests.ada_job')::uuid),
          'processing', 'a reminder already being sent is not touched by the sync');
select is((select problem from public.reminder_details(current_setting('tests.ada_job')::uuid)),
          'activity_cancelled', 'but the dispatcher''s last check stops it for a cancelled activity');

-- Activities added late --------------------------------------------------------------------------
-- A3 starts 15:00 Lagos on 10 April (14:00 UTC); A4 at 10:30 Lagos the same day (09:30 UTC).
insert into public.activities (id, title, activity_date, start_time, timezone, created_by) values
  ('00000000-0000-4000-8000-0000000000a3', 'Short notice', '2035-04-10', '15:00', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000a4', 'Too late',     '2035-04-10', '10:30', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000e1');
insert into public.activity_recipients (activity_id, profile_id, role) values
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000e1', 'responsible'),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000e1', 'responsible');
set constraints all immediate; set constraints all deferred;
-- Pretend they were only just created: forget what the real-clock sync planned.
delete from public.notification_jobs
 where activity_id in ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4');

select is(public.sync_reminders('00000000-0000-4000-8000-0000000000a3', '2035-04-10 09:00+00'), 1,
          'an activity added after its reminder time, with 5 hours to go, gets a reminder');
select results_eq(
  $$ select scheduled_for, run_after from public.notification_jobs where activity_id = '00000000-0000-4000-8000-0000000000a3' $$,
  $$ values ('2035-04-09 14:00+00'::timestamptz, '2035-04-10 09:00+00'::timestamptz) $$,
  'and it goes out at once');
select is(public.sync_reminders('00000000-0000-4000-8000-0000000000a4', '2035-04-10 08:00+00'), 0,
          'with less than 2 hours to go, no reminder is sent');

-- Who may call these --------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.sync_reminders(uuid, timestamptz)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.plan_notifications(timestamptz)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.reminder_details(uuid, timestamptz)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.reminder_job_problem(public.notification_jobs, timestamptz)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.sync_reminders_after_change()', 'EXECUTE'),
          'signed-in users cannot plan reminders or read reminder details directly');
select ok(has_function_privilege('service_role', 'public.reminder_details(uuid, timestamptz)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.plan_notifications(timestamptz)', 'EXECUTE'),
          'the dispatcher can');

select * from finish();
rollback;
