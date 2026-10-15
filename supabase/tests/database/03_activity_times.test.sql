-- Time handling: wall-clock intent in the activity's time zone -> UTC instants, reschedules,
-- versioning and status bookkeeping.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'ada@example.com',  '{"full_name": "Ada Obi"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'bayo@example.com', '{"full_name": "Bayo Ade"}');

insert into public.activities (id, title, activity_date, start_time, end_time, created_by) values
  ('00000000-0000-4000-8000-0000000000d1', 'Timed meeting', '2026-10-19', '09:00', '10:30',
   '00000000-0000-4000-8000-0000000000a1');
insert into public.activities (id, title, activity_date, created_by) values
  ('00000000-0000-4000-8000-0000000000d2', 'All-day deadline', '2026-10-19',
   '00000000-0000-4000-8000-0000000000a1');
insert into public.activities (id, title, activity_date, start_time, timezone, created_by) values
  ('00000000-0000-4000-8000-0000000000d3', 'London call before the clocks change', '2026-03-28', '09:00',
   'Europe/London', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000d4', 'London call after the clocks change', '2026-03-30', '09:00',
   'Europe/London', '00000000-0000-4000-8000-0000000000a1');
insert into public.activities (id, title, activity_date, start_time, starts_at, created_by) values
  ('00000000-0000-4000-8000-0000000000d5', 'Tampered start time', '2026-10-19', '14:00',
   '2000-01-01 00:00+00', '00000000-0000-4000-8000-0000000000a1');

select is((select starts_at from public.activities where id = '00000000-0000-4000-8000-0000000000d1'),
          '2026-10-19 08:00+00'::timestamptz, '09:00 in Lagos (UTC+1) is stored as 08:00 UTC');
select is((select ends_at from public.activities where id = '00000000-0000-4000-8000-0000000000d1'),
          '2026-10-19 09:30+00'::timestamptz, 'the end time is converted the same way');
select is((select starts_at from public.activities where id = '00000000-0000-4000-8000-0000000000d2'),
          '2026-10-18 23:00+00'::timestamptz, 'a date-only activity starts at local midnight');
select is((select ends_at from public.activities where id = '00000000-0000-4000-8000-0000000000d2'),
          '2026-10-19 23:00+00'::timestamptz, 'a date-only activity ends at the next local midnight');
select is((select starts_at from public.activities where id = '00000000-0000-4000-8000-0000000000d3'),
          '2026-03-28 09:00+00'::timestamptz, 'London before the DST change is UTC+0');
select is((select starts_at from public.activities where id = '00000000-0000-4000-8000-0000000000d4'),
          '2026-03-30 08:00+00'::timestamptz, 'London after the DST change is UTC+1');
select is((select starts_at from public.activities where id = '00000000-0000-4000-8000-0000000000d5'),
          '2026-10-19 13:00+00'::timestamptz, 'a client-supplied starts_at is ignored and recomputed');
select is((select version from public.activities where id = '00000000-0000-4000-8000-0000000000d1'),
          1, 'a new activity starts at version 1');

-- Act as a signed-in user. (Still the table owner here, so RLS is not in play in this file.)
select set_config('request.jwt.claims',
                  '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}', true);

update public.activities set activity_date = '2026-10-21', start_time = '15:00', end_time = null
 where id = '00000000-0000-4000-8000-0000000000d1';
select is((select starts_at from public.activities where id = '00000000-0000-4000-8000-0000000000d1'),
          '2026-10-21 14:00+00'::timestamptz, 'rescheduling recomputes starts_at');
select is((select ends_at from public.activities where id = '00000000-0000-4000-8000-0000000000d1'),
          null::timestamptz, 'removing the end time clears ends_at');
select is((select version from public.activities where id = '00000000-0000-4000-8000-0000000000d1'),
          2, 'each update bumps the version');
select is((select updated_by from public.activities where id = '00000000-0000-4000-8000-0000000000d1'),
          '00000000-0000-4000-8000-0000000000a1'::uuid, 'updated_by records the signed-in user');

update public.activities set status = 'cancelled', status_reason = 'Host unavailable'
 where id = '00000000-0000-4000-8000-0000000000d2';
select isnt((select status_changed_at from public.activities where id = '00000000-0000-4000-8000-0000000000d2'),
            null::timestamptz, 'a status change is timestamped');
select is((select status_changed_by from public.activities where id = '00000000-0000-4000-8000-0000000000d2'),
          '00000000-0000-4000-8000-0000000000a1'::uuid, 'a status change records who made it');

update public.activities set created_by = '00000000-0000-4000-8000-0000000000a2'
 where id = '00000000-0000-4000-8000-0000000000d3';
select is((select created_by from public.activities where id = '00000000-0000-4000-8000-0000000000d3'),
          '00000000-0000-4000-8000-0000000000a1'::uuid, 'created_by cannot be changed');

select * from finish();
rollback;
