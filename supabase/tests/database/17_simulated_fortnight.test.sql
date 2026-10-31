-- Two weeks of the real schedule in simulated time (acceptance criteria "summary sent once per
-- week", "reminders reach intended recipients", "cancelled: no reminders", "rescheduling updates
-- notifications"; docs/ACCEPTANCE.md).
--
-- Every 5 minutes from Wednesday 28 February to Wednesday 14 March 2035 (UTC), as pg_cron and the
-- dispatcher do: plan, claim what is due, re-check reminders against their activity, and record
-- the provider accepting the rest. The scheduler is down on Sunday 4 March 15:00-19:00 UTC, across
-- the summary's send time. Midway, one activity is cancelled and another is moved.
-- Office: Africa/Lagos (UTC+1, no clock changes), summary Sunday 17:00 Lagos = 16:00 UTC.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

-- Ada and Bayo receive the summary; Dayo does not.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'ada@example.com',  '{"full_name": "Ada Staff"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'bayo@example.com', '{"full_name": "Bayo Staff"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'dayo@example.com', '{"full_name": "Dayo Staff"}');
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set receives_weekly_summary = false where id = '00000000-0000-4000-8000-0000000000c3';
alter table public.profiles enable trigger profiles_guard_update;

insert into public.activities (id, title, activity_date, start_time, timezone, created_by) values
  -- Tuesday 6 March 10:00 Lagos: reminders Monday 5 March 09:00 UTC.
  ('00000000-0000-4000-8000-0000000000a1', 'Board meeting',  '2035-03-06', '10:00', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000c1'),
  -- Friday 9 March, all day: reminder Thursday 8 March 09:00 Lagos.
  ('00000000-0000-4000-8000-0000000000a2', 'Audit visit',    '2035-03-09', null,    'Africa/Lagos', '00000000-0000-4000-8000-0000000000c1'),
  -- Thursday 8 March 15:00 Lagos: cancelled on Wednesday 7 March, two hours before its reminder.
  ('00000000-0000-4000-8000-0000000000a3', 'Supplier call',  '2035-03-08', '15:00', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000c1'),
  -- Monday 12 March 10:00 Lagos: moved on Saturday 10 March to Tuesday 13 March 10:00.
  ('00000000-0000-4000-8000-0000000000a4', 'Training',       '2035-03-12', '10:00', 'Africa/Lagos', '00000000-0000-4000-8000-0000000000c1');
insert into public.activity_recipients (activity_id, profile_id, role, notify_email) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'responsible',  true),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c2', 'collaborator', true),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c3', 'responsible',  true),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000c1', 'responsible',  true),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000c2', 'responsible',  true);
set constraints all immediate; set constraints all deferred;

-- One scheduler tick every 5 minutes in [p_from, p_to), except while it is down.
create function pg_temp.simulate(p_from timestamptz, p_to timestamptz,
                                 p_down_from timestamptz default null, p_down_to timestamptz default null)
returns void language plpgsql as $$
declare
  t         timestamptz := p_from;
  v_run     uuid;
  v_job     public.notification_jobs;
  v_problem text;
begin
  while t < p_to loop
    if p_down_from is null or t < p_down_from or t >= p_down_to then
      v_run := gen_random_uuid();
      perform public.plan_notifications(t);
      for v_job in select * from public.claim_notification_jobs(v_run, 25, t) loop
        v_problem := case when v_job.kind = 'day_before_reminder'
                          then (select d.problem from public.reminder_details(v_job.id, t) d) end;
        if v_problem is not null then
          perform public.complete_notification_job(v_job.id, v_run, 'skipped', p_reason => v_problem, p_now => t);
        else
          perform public.complete_notification_job(v_job.id, v_run, 'sent', p_provider => 'log',
                    p_provider_message_id => 'log:' || v_job.dedupe_key, p_send_mode => 'test', p_now => t);
        end if;
      end loop;
    end if;
    t := t + interval '5 minutes';
  end loop;
end;
$$;

select pg_temp.simulate('2035-02-28 00:00+00', '2035-03-07 12:00+00', '2035-03-04 15:00+00', '2035-03-04 19:00+00');
update public.activities set status = 'cancelled', status_reason = 'Supplier unavailable'
 where id = '00000000-0000-4000-8000-0000000000a3';
set constraints all immediate; set constraints all deferred;
select pg_temp.simulate('2035-03-07 12:00+00', '2035-03-10 12:00+00');
update public.activities set activity_date = '2035-03-13' where id = '00000000-0000-4000-8000-0000000000a4';
set constraints all immediate; set constraints all deferred;
select pg_temp.simulate('2035-03-10 12:00+00', '2035-03-14 00:00+00');

-- Weekly summary ---------------------------------------------------------------------------------
select results_eq(
  $$ select destination::text, period_start, accepted_at from public.notification_jobs
      where kind = 'weekly_summary' and status = 'sent' order by period_start, destination $$,
  $$ values ('ada@example.com',  '2035-03-05'::date, '2035-03-04 19:00+00'::timestamptz),
            ('bayo@example.com', '2035-03-05'::date, '2035-03-04 19:00+00'::timestamptz),
            ('ada@example.com',  '2035-03-12'::date, '2035-03-11 16:00+00'::timestamptz),
            ('bayo@example.com', '2035-03-12'::date, '2035-03-11 16:00+00'::timestamptz) $$,
  'each subscriber gets one summary a week: after the outage in week one, on time (17:00 Lagos) in week two');
select is((select count(*) from public.notification_jobs where kind = 'weekly_summary' and destination = 'dayo@example.com'),
          0::bigint, 'someone who does not receive the summary has none planned');
select is((select count(*) from public.notification_jobs
            where kind = 'weekly_summary' and period_start > '2035-03-12' and status <> 'pending'),
          0::bigint, 'summaries for the weeks ahead are planned and waiting, none sent early');

-- Reminders ----------------------------------------------------------------------------------------
select results_eq(
  $$ select a.title, j.destination::text, j.accepted_at from public.notification_jobs j
       join public.activities a on a.id = j.activity_id
      where j.kind = 'day_before_reminder' and j.status = 'sent' order by j.accepted_at, j.destination $$,
  $$ values ('Board meeting', 'ada@example.com',  '2035-03-05 09:00+00'::timestamptz),
            ('Board meeting', 'bayo@example.com', '2035-03-05 09:00+00'::timestamptz),
            ('Audit visit',   'dayo@example.com', '2035-03-08 08:00+00'::timestamptz),
            ('Training',      'bayo@example.com', '2035-03-12 09:00+00'::timestamptz) $$,
  'each person listed gets one reminder, 24 hours ahead (all-day: 09:00 Lagos the day before), at the moved time for the moved activity');
select results_eq(
  $$ select status::text, status_reason from public.notification_jobs
      where activity_id = '00000000-0000-4000-8000-0000000000a3' $$,
  $$ values ('cancelled', 'activity_cancelled') $$,
  'the cancelled activity''s reminder is cancelled and never sent');
select results_eq(
  $$ select basis_starts_at, status::text, status_reason from public.notification_jobs
      where activity_id = '00000000-0000-4000-8000-0000000000a4' order by basis_starts_at $$,
  $$ values ('2035-03-12 09:00+00'::timestamptz, 'cancelled', 'rescheduled'),
            ('2035-03-13 09:00+00'::timestamptz, 'sent', null::text) $$,
  'the moved activity''s reminder for the old time is cancelled; the new time gets its own');

-- Each message once ------------------------------------------------------------------------------
select is((select count(*) from public.notification_logs l join public.notification_jobs j on j.id = l.job_id
            where l.event = 'accepted'),
          (select count(*) from public.notification_jobs where status = 'sent'),
          'every sent message was accepted exactly once (about 4,000 runs, no repeats)');
select is((select max(attempt_count) from public.notification_jobs where status = 'sent'), 1,
          'every message went out on its first attempt');
select is((select count(*) from public.notification_jobs where status in ('pending', 'processing') and run_after < '2035-03-14 00:00+00'),
          0::bigint, 'nothing due was left behind');
select is((select count(*) from public.notification_jobs where status in ('failed', 'skipped')), 0::bigint,
          'nothing failed or was skipped along the way');

select * from finish();
rollback;
