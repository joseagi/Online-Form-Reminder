-- Permission matrix: what each kind of user can see and change, enforced by RLS.
--
--   Amaka  (f0) admin
--   Sade   (f1) staff - created O1, R1, R2; added contact C1
--   Tunde  (f2) staff - collaborator on R1, responsible for O2
--   Uche   (f3) staff - created O2, otherwise uninvolved
--   Ifeoma (f4) deactivated staff
--   (f9)        a valid login with no staff profile
--
--   O1 office (Sade)   R1 restricted (Sade, Tunde collaborates)   R2 restricted (Sade only)
--   O2 office (created by Uche, Tunde responsible)
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

-- Test helper: run a statement as the current role and return how many rows it touched.
-- (RLS silently filters UPDATE/DELETE, so "0 rows" is how a denial shows up.)
create schema tests;
create function tests.rows_affected(statement text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant usage on schema tests to authenticated;
grant execute on function tests.rows_affected(text) to authenticated;

-- Isolate from rows already in the database (e.g. users made by browser tests or by
-- `npm run admin:create`), so counts and the last-admin rule see only these fixtures.
-- Everything in this file is rolled back at the end.
alter table public.profiles disable trigger profiles_guard_update;
update public.profiles set is_active = false;
alter table public.profiles enable trigger profiles_guard_update;
delete from public.notification_logs;   -- including the scheduler's run heartbeats
delete from public.notification_jobs;
delete from public.activities;
delete from public.contacts;

-- Fixtures (as the table owner) -----------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f0', 'amaka@example.com',  '{"full_name": "Amaka Admin"}'),
  ('00000000-0000-4000-8000-0000000000f1', 'sade@example.com',   '{"full_name": "Sade Staff"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'tunde@example.com',  '{"full_name": "Tunde Staff"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'uche@example.com',   '{"full_name": "Uche Staff"}'),
  ('00000000-0000-4000-8000-0000000000f4', 'ifeoma@example.com', '{"full_name": "Ifeoma Former"}');
update public.profiles set role = 'admin'    where id = '00000000-0000-4000-8000-0000000000f0';
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000f4';

insert into public.activities (id, title, activity_date, visibility, created_by) values
  ('00000000-0000-4000-8000-000000000a01', 'Office meeting',       '2026-10-20', 'office',     '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a02', 'Restricted HR review', '2026-10-21', 'restricted', '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a03', 'Restricted planning',  '2026-10-22', 'restricted', '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000a04', 'Office workshop',      '2026-10-23', 'office',     '00000000-0000-4000-8000-0000000000f3');
insert into public.activity_recipients (activity_id, profile_id, role) values
  ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000f1', 'responsible'),
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000f1', 'responsible'),
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000f2', 'collaborator'),
  ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-0000000000f1', 'responsible'),
  ('00000000-0000-4000-8000-000000000a04', '00000000-0000-4000-8000-0000000000f2', 'responsible');
insert into public.contacts (id, full_name, email, created_by) values
  ('00000000-0000-4000-8000-000000000c01', 'Partner Contact', 'partner@org.example',
   '00000000-0000-4000-8000-0000000000f1');

insert into public.notification_jobs
  (kind, channel, dedupe_key, activity_id, profile_id, destination, basis_starts_at, scheduled_for, run_after)
select 'day_before_reminder'::public.notification_kind, 'email'::public.notification_channel,
       'rem:email:' || a.id || ':p:00000000-0000-4000-8000-0000000000f1',
       a.id, '00000000-0000-4000-8000-0000000000f1', 'sade@example.com',
       a.starts_at, a.starts_at - interval '24 hours', a.starts_at - interval '24 hours'
  from public.activities a
 where a.id in ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a03');
insert into public.notification_logs (job_id, event)
select id, 'planned' from public.notification_jobs;

set local role authenticated;

-- Tunde: collaborator on R1, responsible for O2 -----------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);

select set_eq(
  $$ select id from public.activities $$,
  array['00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a02',
        '00000000-0000-4000-8000-000000000a04']::uuid[],
  'a collaborator sees office activities plus the restricted ones they are on');
select is((select count(*)::int from public.activity_recipients
            where activity_id = '00000000-0000-4000-8000-000000000a02'),
          2, 'a collaborator sees who else is on a restricted activity');
select is(tests.rows_affected($$ update public.activities set location = 'Moved'
                                  where id = '00000000-0000-4000-8000-000000000a02' $$),
          0, 'a collaborator cannot edit the activity');
select is(tests.rows_affected($$ update public.activities set location = 'Hall B'
                                  where id = '00000000-0000-4000-8000-000000000a04' $$),
          1, 'the responsible person can edit an activity they did not create');
select is(tests.rows_affected($$ delete from public.activity_recipients
                                  where activity_id = '00000000-0000-4000-8000-000000000a02'
                                    and profile_id  = '00000000-0000-4000-8000-0000000000f1' $$),
          0, 'a collaborator cannot remove other people from the activity');
select is(tests.rows_affected($$ update public.profiles set phone = '+2348031234567'
                                  where id = '00000000-0000-4000-8000-0000000000f2' $$),
          1, 'staff can update their own phone number');
select is(tests.rows_affected($$ update public.profiles set full_name = 'Changed'
                                  where id = '00000000-0000-4000-8000-0000000000f3' $$),
          0, 'staff cannot edit a colleague''s profile');
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000f2' $$,
  '42501', 'Only an administrator can change role, access or notification settings',
  'staff cannot make themselves an admin');
select throws_ok(
  $$ update public.profiles set email = 'tunde.new@example.com' where id = '00000000-0000-4000-8000-0000000000f2' $$,
  '42501', null, 'the profile email cannot be changed directly');
select is((select count(*)::int from public.contacts), 1, 'staff can read the shared contact list');
select is(tests.rows_affected($$ update public.contacts set organisation = 'Other Org'
                                  where id = '00000000-0000-4000-8000-000000000c01' $$),
          0, 'staff cannot edit a contact someone else added');
select lives_ok(
  $$ insert into public.contacts (full_name, email) values ('New Contact', 'new.contact@org.example') $$,
  'staff can add a contact');
select is((select count(*)::int from public.notification_jobs), 0,
          'staff cannot see reminder jobs for activities they cannot edit');

-- Uche: staff, not involved in O1/R1/R2 ----------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}', true);

select set_eq(
  $$ select id from public.activities $$,
  array['00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a04']::uuid[],
  'uninvolved staff see only office activities');
select is((select count(*)::int from public.activity_recipients
            where activity_id = '00000000-0000-4000-8000-000000000a02'),
          0, 'people on a restricted activity are hidden from uninvolved staff');
select is(tests.rows_affected($$ update public.activities set location = 'Elsewhere'
                                  where id = '00000000-0000-4000-8000-000000000a01' $$),
          0, 'staff cannot edit an office activity they neither created nor lead');
select throws_ok(
  $$ insert into public.activity_recipients (activity_id, profile_id, role)
     values ('00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-0000000000f3', 'collaborator') $$,
  '42501', null, 'staff cannot add themselves to an activity they cannot edit');
select lives_ok(
  $$ insert into public.activities (title, activity_date) values ('Team catch-up', '2026-10-26') $$,
  'any active staff member can create an activity');
select throws_ok(
  $$ insert into public.activities (title, activity_date, created_by)
     values ('Impersonation', '2026-10-26', '00000000-0000-4000-8000-0000000000f1') $$,
  '42501', null, 'staff cannot create an activity in someone else''s name');
select is((select count(*)::int from public.system_settings), 0, 'staff cannot read the system settings');
select is(tests.rows_affected($$ update public.system_settings set notification_mode = 'live' $$),
          0, 'staff cannot switch notifications to live');
select is((select count(*)::int from public.audit_logs), 0, 'staff cannot read the audit log');
select is((select count(*)::int from public.notification_logs), 0, 'staff cannot read the notification logs');

-- Sade: creator of O1, R1, R2 and contact C1 ----------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);

select is((select count(*)::int from public.activities
            where id in ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a02',
                         '00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000a04')),
          4, 'the creator sees office activities and their own restricted ones');
select is(tests.rows_affected($$ update public.activities set location = 'Room 1'
                                  where id = '00000000-0000-4000-8000-000000000a01' $$),
          1, 'the creator can edit their activity');
select lives_ok(
  $$ insert into public.activities (title, activity_date, visibility)
     values ('Private note', '2026-10-27', 'restricted') returning id $$,
  'creating a restricted activity and reading it back (insert ... returning) works');
select lives_ok(
  $$ insert into public.activity_recipients (activity_id, profile_id, role)
     values ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000f3', 'collaborator') $$,
  'the creator can add a collaborator');
select is(tests.rows_affected($$ delete from public.activity_recipients
                                  where activity_id = '00000000-0000-4000-8000-000000000a02'
                                    and profile_id  = '00000000-0000-4000-8000-0000000000f2' $$),
          1, 'the creator can remove a collaborator');
select is((select count(*)::int from public.notification_jobs), 2,
          'the creator sees the reminder jobs for their activities');
select is(tests.rows_affected($$ update public.contacts set organisation = 'Partner Org'
                                  where id = '00000000-0000-4000-8000-000000000c01' $$),
          1, 'the person who added a contact can edit it');
select throws_ok(
  $$ delete from public.activities where id = '00000000-0000-4000-8000-000000000a01' $$,
  '42501', null, 'activities cannot be deleted (they are cancelled instead)');

-- Tunde again, after being removed from R1 ------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);

select is((select count(*)::int from public.activities where id = '00000000-0000-4000-8000-000000000a02'),
          0, 'removing a collaborator also removes their access to a restricted activity');

-- Ifeoma: deactivated -----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f4", "role": "authenticated"}', true);

select is((select count(*)::int from public.activities), 0, 'a deactivated user sees no activities');
select is((select count(*)::int from public.profiles), 0, 'a deactivated user cannot read the staff directory');
select throws_ok(
  $$ insert into public.activities (title, activity_date) values ('Still here', '2026-10-28') $$,
  '42501', null, 'a deactivated user cannot create activities');

-- A valid login with no staff profile -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f9", "role": "authenticated"}', true);

select is((select count(*)::int from public.activities), 0, 'a login without a staff profile sees nothing');
select throws_ok(
  $$ insert into public.activities (title, activity_date) values ('Outsider', '2026-10-28') $$,
  '42501', null, 'a login without a staff profile cannot create activities');

-- Amaka: admin ------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f0", "role": "authenticated"}', true);

select is((select count(*)::int from public.activities
            where id in ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a02',
                         '00000000-0000-4000-8000-000000000a03', '00000000-0000-4000-8000-000000000a04')),
          4, 'an admin sees every activity, including restricted ones');
select is(tests.rows_affected($$ update public.activities set location = 'Board room'
                                  where id = '00000000-0000-4000-8000-000000000a02' $$),
          1, 'an admin can edit any activity');
select is((select count(*)::int from public.system_settings), 1, 'an admin can read the settings');
select is(tests.rows_affected($$ update public.system_settings set weekly_summary_send_time = '18:00' $$),
          1, 'an admin can change the settings');
select ok((select count(*) from public.audit_logs) > 0, 'an admin can read the audit log');
select is((select count(*)::int from public.notification_logs), 2, 'an admin can read the notification logs');
select throws_ok(
  $$ update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-0000000000f0' $$,
  '23514', 'At least one active administrator is required', 'the last active admin cannot be demoted');
select is(tests.rows_affected($$ update public.profiles set role = 'admin'
                                  where id = '00000000-0000-4000-8000-0000000000f3' $$),
          1, 'an admin can promote a staff member');
select is(tests.rows_affected($$ update public.profiles set is_active = false
                                  where id = '00000000-0000-4000-8000-0000000000f2' $$),
          1, 'an admin can deactivate a staff member');

-- Tunde, now deactivated ------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);

select is((select count(*)::int from public.activities), 0, 'a deactivated member loses access immediately');

-- Privileges that would bypass RLS altogether ---------------------------------------------
reset role;

select ok(not has_table_privilege('authenticated', 'public.activities', 'DELETE, TRUNCATE'),
          'signed-in users hold no DELETE or TRUNCATE privilege on activities');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT, DELETE, TRUNCATE'),
          'profiles are only created by the Auth trigger and never deleted through the API');

select * from finish();
rollback;
