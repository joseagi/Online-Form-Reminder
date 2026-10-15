-- Data integrity: profile creation from Auth, and constraints on every core table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'ada@example.com',  '{"full_name": "Ada Obi"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'bayo@example.com', '{}'),
  ('00000000-0000-4000-8000-0000000000a3', 'eve@example.com',  '{"full_name": "Eve", "role": "admin"}');

-- Profiles come from the Auth trigger -----------------------------------------------
select is((select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000000a1'),
          'Ada Obi', 'a profile is created from the invite metadata');
select is((select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000000a2'),
          'bayo', 'a missing name falls back to the email local part');
select is((select role from public.profiles where id = '00000000-0000-4000-8000-0000000000a1'),
          'staff'::public.app_role, 'new users are staff');
select is((select role from public.profiles where id = '00000000-0000-4000-8000-0000000000a3'),
          'staff'::public.app_role, 'a role in user metadata is ignored');

update auth.users set email = 'ada.obi@example.com' where id = '00000000-0000-4000-8000-0000000000a1';
select is((select email::text from public.profiles where id = '00000000-0000-4000-8000-0000000000a1'),
          'ada.obi@example.com', 'an email change in Auth is copied to the profile');

-- Activities ------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.activities (title, activity_date, created_by)
     values ('   ', '2026-10-19', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a blank title is rejected');
select throws_ok(
  $$ insert into public.activities (title, activity_date, start_time, end_time, created_by)
     values ('Meeting', '2026-10-19', '10:00', '09:00', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'an end time before the start time is rejected');
select throws_ok(
  $$ insert into public.activities (title, activity_date, end_time, created_by)
     values ('Meeting', '2026-10-19', '09:00', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'an end time without a start time is rejected');
select throws_ok(
  $$ insert into public.activities (title, activity_date, timezone, created_by)
     values ('Meeting', '2026-10-19', 'Mars/Olympus', '00000000-0000-4000-8000-0000000000a1') $$,
  '22023', 'Unknown time zone: Mars/Olympus', 'an unknown time zone is rejected');
select throws_ok(
  $$ insert into public.activities (title, activity_date, meeting_url, created_by)
     values ('Meeting', '2026-10-19', 'javascript:alert(1)', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a meeting link must be an http(s) URL');
select lives_ok(
  $$ insert into public.activities (id, title, activity_date, created_by)
     values ('00000000-0000-4000-8000-0000000000b1', 'Report deadline', '2026-10-19',
             '00000000-0000-4000-8000-0000000000a1') $$,
  'a minimal date-only activity is accepted');

-- Contacts and profile fields ---------------------------------------------------------
select throws_ok(
  $$ insert into public.contacts (full_name, email, created_by)
     values ('Bad Email', 'not-an-email', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'an invalid email address is rejected');
select throws_ok(
  $$ insert into public.contacts (full_name, created_by)
     values ('No Channel', '00000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a contact needs an email or a phone number');
select throws_ok(
  $$ update public.profiles set phone = '0803 123 4567' where id = '00000000-0000-4000-8000-0000000000a2' $$,
  '23514', null, 'phone numbers must be in international E.164 form');

-- Recipients --------------------------------------------------------------------------
insert into public.contacts (id, full_name, email, created_by) values
  ('00000000-0000-4000-8000-0000000000c1', 'Chidi Partner', 'chidi@partner.example',
   '00000000-0000-4000-8000-0000000000a1');
insert into public.activity_recipients (activity_id, profile_id, role) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'responsible');

select throws_ok(
  $$ insert into public.activity_recipients (activity_id, profile_id, contact_id, role)
     values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2',
             '00000000-0000-4000-8000-0000000000c1', 'collaborator') $$,
  '23514', null, 'a recipient is staff or an external contact, not both');
select throws_ok(
  $$ insert into public.activity_recipients (activity_id, role)
     values ('00000000-0000-4000-8000-0000000000b1', 'collaborator') $$,
  '23514', null, 'a recipient must reference a person');
select throws_ok(
  $$ insert into public.activity_recipients (activity_id, profile_id, role)
     values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'responsible') $$,
  '23505', null, 'an activity has at most one responsible person');
select throws_ok(
  $$ insert into public.activity_recipients (activity_id, contact_id, role)
     values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 'responsible') $$,
  '23514', null, 'the responsible person must be a staff member');
select throws_ok(
  $$ insert into public.activity_recipients (activity_id, profile_id, role)
     values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'collaborator') $$,
  '23505', null, 'the same staff member cannot be added twice');
select lives_ok(
  $$ insert into public.activity_recipients (activity_id, contact_id, role)
     values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1', 'collaborator') $$,
  'an external collaborator can be added');

-- Settings ------------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.system_settings (id) values (false) $$,
  '23514', null, 'system_settings cannot get a second row');
select throws_ok(
  $$ update public.system_settings set timezone = 'Mars/Olympus' $$,
  '22023', 'Unknown time zone: Mars/Olympus', 'settings reject an unknown time zone');
select throws_ok(
  $$ update public.system_settings set reminder_lead = interval '30 days' $$,
  '23514', null, 'the reminder lead time must be between 1 hour and 7 days');
select throws_ok(
  $$ update public.system_settings set email_from_name = e'Office\nBcc: x@evil.example' $$,
  '23514', null, 'the sender name cannot contain line breaks (header injection)');

select * from finish();
rollback;
