-- Weekly summary content and planning, and the notification queue, with simulated time.
--
-- Office: Africa/Lagos (UTC+1). The week under test is Monday 2 Nov - Sunday 8 Nov 2026; its
-- summary goes out on Sunday 1 Nov. Subscribers: Ada and Dele (staff) and Partner (contact).
-- Bayo opted out, Chika has left, and the old partner contact is inactive.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Isolate from data already in the local database. Everything here is rolled back at the end.
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false;
alter table public.profiles enable trigger profiles_guard_update;
update public.contacts set is_active = false;
delete from public.notification_jobs;
delete from public.activities;
update public.system_settings
   set timezone = 'Africa/Lagos', weekly_summary_enabled = true,
       weekly_summary_send_time = '17:00', weekly_summary_late_cutoff = '16 hours';

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'ada@example.com',   '{"full_name": "Ada Admin"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'bayo@example.com',  '{"full_name": "Bayo Staff"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'chika@example.com', '{"full_name": "Chika Former"}'),
  ('00000000-0000-4000-8000-0000000000f4', 'dele@example.com',  '{"full_name": "Dele Staff"}');
update public.profiles set receives_weekly_summary = false where id = '00000000-0000-4000-8000-0000000000f2';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000f3';
insert into public.contacts (id, full_name, email, receives_weekly_summary, is_active, created_by) values
  ('00000000-0000-4000-8000-000000000c01', 'Partner Contact', 'partner@org.example', true, true,
   '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000c02', 'Old Partner', 'old@org.example', true, false,
   '00000000-0000-4000-8000-0000000000f1');

-- Activities around the week's edges (times in Lagos unless stated).
insert into public.activities (id, title, activity_date, start_time, timezone, status, visibility,
                               include_in_weekly_summary, created_by) values
  ('00000000-0000-4000-8000-000000000a01', 'Sunday night before',  '2026-11-01', '23:59', 'Africa/Lagos',  'scheduled', 'office', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a02', 'Monday midnight',      '2026-11-02', '00:00', 'Africa/Lagos',  'scheduled', 'office', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a03', 'Monday all day',       '2026-11-02', null,    'Africa/Lagos',  'scheduled', 'office', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a04', 'Sunday late',          '2026-11-08', '23:59', 'Africa/Lagos',  'scheduled', 'office', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a05', 'Next Monday midnight', '2026-11-09', '00:00', 'Africa/Lagos',  'scheduled', 'office', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a06', 'Cancelled in week',    '2026-11-04', '10:00', 'Africa/Lagos',  'cancelled', 'office', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a07', 'Restricted in week',   '2026-11-04', '11:00', 'Africa/Lagos',  'scheduled', 'restricted', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a08', 'Left out of summary',  '2026-11-04', '12:00', 'Africa/Lagos',  'scheduled', 'office', false, '00000000-0000-4000-8000-0000000000f1'),
  -- London is UTC+0 in November: 23:30 London = 00:30 Lagos the next day.
  ('00000000-0000-4000-8000-000000000a09', 'London Sunday late',   '2026-11-08', '23:30', 'Europe/London', 'scheduled', 'office', true, '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a10', 'London early Monday',  '2026-11-01', '23:30', 'Europe/London', 'scheduled', 'office', true, '00000000-0000-4000-8000-0000000000f1');
insert into public.activity_recipients (activity_id, profile_id, contact_id, role) values
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000f1', null, 'responsible'),
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000f4', null, 'collaborator'),
  ('00000000-0000-4000-8000-000000000a02', null, '00000000-0000-4000-8000-000000000c01', 'collaborator');

-- Content -----------------------------------------------------------------------------------
select results_eq(
  $$ select title from public.weekly_summary_items('2026-11-02') $$,
  $$ values ('Monday all day'), ('Monday midnight'), ('London early Monday'), ('Sunday late') $$,
  'the summary covers Monday 00:00 to the next Monday 00:00 in the office time zone, in time order');
select results_eq(
  $$ select responsible_name, collaborator_names from public.weekly_summary_items('2026-11-02')
      where title = 'Monday midnight' $$,
  $$ values ('Ada Admin', array['Dele Staff', 'Partner Contact']) $$,
  'each item names the responsible person and the collaborators');

-- Planning on Wednesday 28 Oct (12:00 Lagos) --------------------------------------------------
select is(public.plan_weekly_summaries('2026-10-28 11:00+00'), 3, 'one job per subscriber is planned for the coming Sunday');
select set_eq(
  $$ select destination from public.notification_jobs where period_start = '2026-11-02' $$,
  array['ada@example.com', 'dele@example.com', 'partner@org.example'],
  'only active subscribers get a job (not opted-out, departed or inactive people)');
select results_eq(
  $$ select distinct scheduled_for, expires_at from public.notification_jobs where period_start = '2026-11-02' $$,
  $$ values ('2026-11-01 16:00+00'::timestamptz, '2026-11-02 08:00+00'::timestamptz) $$,
  'jobs are due Sunday 17:00 Lagos and expire at the late cutoff (Monday 09:00 Lagos)');
select is(public.plan_weekly_summaries('2026-10-28 11:05+00'), 0, 'planning again changes nothing (no duplicates)');

update public.system_settings set weekly_summary_send_time = '18:30';
select is(public.plan_weekly_summaries('2026-10-28 11:10+00'), 3, 'a new send time updates the pending jobs');
select is((select min(scheduled_for) from public.notification_jobs where period_start = '2026-11-02'),
          '2026-11-01 17:30+00'::timestamptz, 'jobs now go out at 18:30 Lagos');

update public.profiles set receives_weekly_summary = false where id = '00000000-0000-4000-8000-0000000000f4';
select public.plan_weekly_summaries('2026-10-28 11:15+00');
select results_eq(
  $$ select status::text, status_reason from public.notification_jobs
      where profile_id = '00000000-0000-4000-8000-0000000000f4' $$,
  $$ values ('cancelled', 'unsubscribed') $$,
  'someone who opts out before Sunday has their job cancelled');
update public.profiles set receives_weekly_summary = true where id = '00000000-0000-4000-8000-0000000000f4';
select public.plan_weekly_summaries('2026-10-28 11:20+00');
select is((select status::text from public.notification_jobs where profile_id = '00000000-0000-4000-8000-0000000000f4'),
          'pending', 'opting back in restores the same job');

update public.system_settings set weekly_summary_enabled = false;
select public.plan_weekly_summaries('2026-10-28 11:25+00');
select is((select count(*)::int from public.notification_jobs where status = 'cancelled' and status_reason = 'summary_disabled'),
          3, 'switching the summary off cancels the pending jobs');
update public.system_settings set weekly_summary_enabled = true;
select public.plan_weekly_summaries('2026-10-28 11:30+00');
select is((select count(*)::int from public.notification_jobs where period_start = '2026-11-02' and status = 'pending'),
          3, 'switching it back on restores them');
select is((select count(*)::int from public.notification_jobs where period_start = '2026-11-02'),
          3, 'still exactly one job per subscriber');

-- Remember each job for the queue tests.
select set_config('tests.ada',  (select id::text from public.notification_jobs where profile_id = '00000000-0000-4000-8000-0000000000f1'), true);
select set_config('tests.dele', (select id::text from public.notification_jobs where profile_id = '00000000-0000-4000-8000-0000000000f4'), true);
select set_config('tests.partner', (select id::text from public.notification_jobs where contact_id = '00000000-0000-4000-8000-000000000c01'), true);

-- Claiming on Sunday 1 Nov ---------------------------------------------------------------------
select is((select count(*)::int from public.claim_notification_jobs(gen_random_uuid(), 25, '2026-11-01 17:00+00')),
          0, 'nothing is handed out before it is due');
select is((select count(*)::int from public.claim_notification_jobs(gen_random_uuid(), 2, '2026-11-01 17:30+00')),
          2, 'due jobs are handed out, up to the batch size');
select is((select count(*)::int from public.claim_notification_jobs(gen_random_uuid(), 25, '2026-11-01 17:30+00')),
          1, 'a second run at the same moment gets only the remaining job, never one already in progress');
select is((select count(*)::int from public.notification_jobs where status = 'processing' and attempt_count = 1),
          3, 'all three are now in progress, first attempt');

select results_eq(
  format($$ select subject from public.freeze_notification_payload('%s', 'Week of 2 Nov', '<p>v1</p>', 'v1') $$, current_setting('tests.ada')),
  $$ values ('Week of 2 Nov') $$, 'the first render is stored');
select results_eq(
  format($$ select subject, body_text from public.freeze_notification_payload('%s', 'CHANGED', '<p>v2</p>', 'v2') $$, current_setting('tests.ada')),
  $$ values ('Week of 2 Nov', 'v1') $$, 'later renders get the stored payload back, so retries send the same message');

select is(public.complete_notification_job(current_setting('tests.ada')::uuid, gen_random_uuid(), 'sent',
            p_provider => 'log', p_provider_message_id => 'log-ada', p_send_mode => 'test', p_now => '2026-11-01 17:30:05+00'),
          'sent'::public.job_status, 'a provider acceptance marks the job sent');
select results_eq(
  format($$ select accepted_at, send_mode::text, delivery_status::text from public.notification_jobs where id = '%s' $$, current_setting('tests.ada')),
  $$ values ('2026-11-01 17:30:05+00'::timestamptz, 'test', 'unknown') $$,
  'accepted is recorded separately from delivery, which stays unknown until confirmed');

select is(public.plan_weekly_summaries('2026-11-01 17:31+00'), 3,
          'planning after sending only adds next week''s jobs');
select is((select count(*)::int from public.notification_jobs where period_start = '2026-11-02'),
          3, 'this week still has exactly one job per subscriber');
select is((select status::text from public.notification_jobs where id = current_setting('tests.ada')::uuid),
          'sent', 'the sent job stays sent');

select is(public.complete_notification_job(current_setting('tests.dele')::uuid, gen_random_uuid(), 'retry',
            p_http_status => 503, p_error_message => 'Service unavailable', p_now => '2026-11-01 17:30:10+00'),
          'pending'::public.job_status, 'a temporary failure puts the job back in the queue');
select results_eq(
  format($$ select run_after, last_error_message from public.notification_jobs where id = '%s' $$, current_setting('tests.dele')),
  $$ values ('2026-11-01 17:31:10+00'::timestamptz, 'Service unavailable') $$,
  'it waits before retrying (1 minute after the first attempt) and keeps the error');

-- The partner's run "crashed": no outcome was recorded, so the lease runs out.
select is((select count(*)::int from public.claim_notification_jobs(gen_random_uuid(), 25, '2026-11-01 17:36+00')),
          2, 'after its lease expires a crashed job is handed out again, with the due retry');
select is((select attempt_count from public.notification_jobs where id = current_setting('tests.partner')::uuid),
          2, 'the crashed job is on its second attempt');

select is(public.complete_notification_job(current_setting('tests.dele')::uuid, gen_random_uuid(), 'retry',
            p_now => '2026-11-01 17:37+00'),
          'pending'::public.job_status, 'the second failure waits longer');
select is((select run_after from public.notification_jobs where id = current_setting('tests.dele')::uuid),
          '2026-11-01 17:42+00'::timestamptz, 'second wait is 5 minutes');

-- Monday 2 Nov 09:31 UTC: past the late cutoff (18:30 Lagos + 16 hours = 10:30 Lagos).
select is((select count(*)::int from public.claim_notification_jobs(gen_random_uuid(), 25, '2026-11-02 09:31+00')),
          0, 'nothing is sent after the late cutoff');
select results_eq(
  $$ select coalesce(profile_id, contact_id)::text, status::text, status_reason from public.notification_jobs
      where period_start = '2026-11-02' order by 1 $$,
  $$ values ('00000000-0000-4000-8000-0000000000f1', 'sent', null),
            ('00000000-0000-4000-8000-0000000000f4', 'skipped', 'expired'),
            ('00000000-0000-4000-8000-000000000c01', 'failed', 'outcome_unknown') $$,
  'a waiting retry is skipped as expired; an attempt with unknown outcome is flagged for a person to check');
select ok((select count(*) >= 6 from public.notification_logs
            where job_id = current_setting('tests.dele')::uuid or job_id = current_setting('tests.ada')::uuid),
          'every claim and outcome is logged');

-- Recovery: nothing ran at all on Sunday 8 Nov (send time back to 17:00) ---------------------------
update public.system_settings set weekly_summary_send_time = '17:00';
select is(public.plan_weekly_summaries('2026-11-09 07:00+00'), 6,
          'at 08:00 Lagos on Monday, the missed Sunday''s jobs are brought up to date and next week is planned');
select is((select count(*)::int from public.claim_notification_jobs(gen_random_uuid(), 25, '2026-11-09 07:00+00')),
          3, 'the missed summaries go out straight away, before the 09:00 cutoff');

-- A Monday when the cutoff has already passed and that Sunday was never planned.
select is(public.plan_weekly_summaries('2026-11-23 08:30+00'), 3, 'after the cutoff, only next week is planned');
select is((select count(*)::int from public.notification_jobs where period_start = '2026-11-23'),
          0, 'a Sunday missed past its cutoff is not sent late');

-- Who may call these --------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.claim_notification_jobs(uuid, integer, timestamptz, interval)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.plan_weekly_summaries(timestamptz)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.weekly_summary_items(date)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.complete_notification_job(uuid, uuid, text, text, text, public.notification_mode, integer, text, text, text, interval, timestamptz)', 'EXECUTE'),
          'signed-in users cannot plan, claim, complete or read summaries directly');

select * from finish();
rollback;
