-- Time zones across clock changes. The office is put in Europe/London here (Lagos has no daylight
-- saving), so the summary and reminder planners themselves meet the changes:
--   Sunday 28 March 2027:   clocks go forward at 01:00 GMT -> 02:00 BST (UTC+1)
--   Sunday 31 October 2027: clocks go back at 02:00 BST -> 01:00 GMT (UTC+0)
-- Decisions recorded here (2026-10-28):
--   * the reminder lead is exact hours ("24 hours before" is 24 real hours, also across a change);
--   * a clock time that does not exist (01:30 on 28 March) is accepted, and stored an hour later
--     (02:30 BST); a time that happens twice (01:30 on 31 October) is the second one (GMT).
-- Reminders are planned at the end of each transaction; "flush" makes that happen (see test 11).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Isolate from data already in the local database. Everything here is rolled back at the end.
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false;
alter table public.profiles enable trigger profiles_guard_update;
update public.contacts set is_active = false;
delete from public.notification_jobs;
delete from public.activities;
update public.system_settings
   set timezone = 'Europe/London', reminder_lead = '24 hours', date_only_reminder_time = '09:00',
       reminder_min_notice = '2 hours', weekly_summary_enabled = true, weekly_summary_send_time = '17:00',
       weekly_summary_late_cutoff = '16 hours';
set constraints all immediate; set constraints all deferred;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000e9', 'tz@example.com', '{"full_name": "Tunde Zone"}');

create function pg_temp.add(p_title text, p_date date, p_start time) returns void language sql as $$
  with a as (
    insert into public.activities (title, activity_date, start_time, timezone, created_by)
    values (p_title, p_date, p_start, 'Europe/London', '00000000-0000-4000-8000-0000000000e9')
    returning id)
  insert into public.activity_recipients (activity_id, profile_id, role, notify_email)
  select id, '00000000-0000-4000-8000-0000000000e9', 'responsible', true from a;
$$;
create function pg_temp.starts(p_title text) returns timestamptz language sql as $$
  select starts_at from public.activities where title = p_title
$$;
create function pg_temp.reminder(p_title text) returns timestamptz language sql as $$
  select j.scheduled_for from public.notification_jobs j join public.activities a on a.id = j.activity_id where a.title = p_title
$$;

select pg_temp.add('Spring Sunday 10:00',      '2027-03-28', '10:00');
select pg_temp.add('Autumn Sunday 10:00',      '2027-10-31', '10:00');
select pg_temp.add('Spring all day Monday',    '2027-03-29', null);
select pg_temp.add('Autumn all day Monday',    '2027-11-01', null);
select pg_temp.add('Spring change day',        '2027-03-28', null);
select pg_temp.add('Missing 01:30',            '2027-03-28', '01:30');
select pg_temp.add('Twice 01:30',              '2027-10-31', '01:30');
select pg_temp.add('Spring Sunday 23:30',      '2027-03-28', '23:30');
select pg_temp.add('Spring Monday 00:30',      '2027-03-29', '00:30');
select pg_temp.add('Autumn Sunday 23:30',      '2027-10-31', '23:30');
set constraints all immediate; set constraints all deferred;

-- Clock times that don't exist, or exist twice ---------------------------------------------------
select is(pg_temp.starts('Missing 01:30'), '2027-03-28 01:30+00'::timestamptz,
          '01:30 on the morning the clocks go forward does not exist: it is stored as 02:30 BST');
select is((select start_time from public.activities where title = 'Missing 01:30'), '01:30'::time,
          'the clock time entered is kept as entered');
select is(pg_temp.starts('Twice 01:30'), '2027-10-31 01:30+00'::timestamptz,
          '01:30 on the morning the clocks go back happens twice: the second one (GMT) is used');

-- An all-day activity on the day of a change is 23 or 25 hours long.
select is((select ends_at - starts_at from public.activities where title = 'Spring change day'), interval '23 hours',
          'the day the clocks go forward is 23 hours long');

-- Reminders ---------------------------------------------------------------------------------------
select is(pg_temp.reminder('Spring Sunday 10:00'), '2027-03-27 09:00+00'::timestamptz,
          '24 hours before 10:00 BST on the change Sunday is 09:00 GMT on Saturday (exact hours, not the same clock time)');
select is(pg_temp.reminder('Autumn Sunday 10:00'), '2027-10-30 10:00+00'::timestamptz,
          '24 hours before 10:00 GMT on the change Sunday is 11:00 BST on Saturday');
select is(pg_temp.reminder('Spring all day Monday'), '2027-03-28 08:00+00'::timestamptz,
          'an all-day activity is reminded at 09:00 office time the day before, even on the change day (09:00 BST)');
select is(pg_temp.reminder('Autumn all day Monday'), '2027-10-31 09:00+00'::timestamptz,
          'and on the day the clocks go back (09:00 GMT)');
select is(pg_temp.reminder('Missing 01:30'), '2027-03-27 01:30+00'::timestamptz,
          'a reminder follows the stored instant of a non-existent clock time');

-- Weekly summary: send time and late cutoff ------------------------------------------------------
select public.plan_weekly_summaries('2027-03-24 12:00+00');
select results_eq(
  $$ select scheduled_for, expires_at from public.notification_jobs where kind = 'weekly_summary' and period_start = '2027-03-29' $$,
  $$ values ('2027-03-28 16:00+00'::timestamptz, '2027-03-29 08:00+00'::timestamptz) $$,
  'on the Sunday the clocks go forward, the summary goes at 17:00 BST, and may still go until 09:00 BST Monday');
select public.plan_weekly_summaries('2027-10-27 12:00+00');
select results_eq(
  $$ select scheduled_for, expires_at from public.notification_jobs where kind = 'weekly_summary' and period_start = '2027-11-01' $$,
  $$ values ('2027-10-31 17:00+00'::timestamptz, '2027-11-01 09:00+00'::timestamptz) $$,
  'on the Sunday the clocks go back, it goes at 17:00 GMT, and may still go until 09:00 GMT Monday');

-- Weekly summary: which week an activity belongs to -------------------------------------------------
select is(('2027-03-29'::timestamp at time zone 'Europe/London') - ('2027-03-22'::timestamp at time zone 'Europe/London'),
          interval '167 hours', 'the week the clocks go forward is 167 hours long');
select is(('2027-11-01'::timestamp at time zone 'Europe/London') - ('2027-10-25'::timestamp at time zone 'Europe/London'),
          interval '169 hours', 'the week the clocks go back is 169 hours long');
select ok('Spring Sunday 23:30' in (select title from public.weekly_summary_items('2027-03-22')),
          'Sunday 23:30 BST is the end of the week the clocks went forward');
select ok('Spring Monday 00:30' not in (select title from public.weekly_summary_items('2027-03-22'))
          and 'Spring Monday 00:30' in (select title from public.weekly_summary_items('2027-03-29')),
          'Monday 00:30 BST belongs to the next week (although it is still Sunday in UTC)');
select ok('Autumn Sunday 23:30' in (select title from public.weekly_summary_items('2027-10-25'))
          and 'Autumn Sunday 23:30' not in (select title from public.weekly_summary_items('2027-11-01')),
          'Sunday 23:30 GMT, in the 169-hour week, still belongs to it');
select ok('Twice 01:30' in (select title from public.weekly_summary_items('2027-10-25')),
          'the twice-happening 01:30 is in its own week');

-- The summary content gives the start instant, for the office day and office-time equivalent.
select ok((select bool_and(starts_at is not null) from public.weekly_summary_items('2027-03-22')),
          'summary items carry their start instant');
select ok((select starts_at = '2027-03-27 09:00+00'::timestamptz + interval '24 hours'
             from public.reminder_details((select j.id from public.notification_jobs j join public.activities a on a.id = j.activity_id
                                            where a.title = 'Spring Sunday 10:00'), '2027-03-20 00:00+00')),
          'reminder details carry the start instant too');

select * from finish();
rollback;
