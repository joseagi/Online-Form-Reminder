-- save_activity, set_activity_recipients, set_activity_status and office_info.
--
--   Sade   (f1) staff - creates the activity
--   Tunde  (f2) staff - collaborator, later responsible, then hands over
--   Uche   (f3) staff - takes over as responsible
--   Ifeoma (f4) deactivated staff
--   c01 active external contact, c02 inactive external contact
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'sade@example.com',   '{"full_name": "Sade Staff"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'tunde@example.com',  '{"full_name": "Tunde Staff"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'uche@example.com',   '{"full_name": "Uche Staff"}'),
  ('00000000-0000-4000-8000-0000000000f4', 'ifeoma@example.com', '{"full_name": "Ifeoma Former"}');
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000f4';
insert into public.contacts (id, full_name, email, is_active, created_by) values
  ('00000000-0000-4000-8000-000000000c01', 'Partner Contact', 'partner@org.example', true,  '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000c02', 'Former Partner',  'former@org.example',  false, '00000000-0000-4000-8000-0000000000f1');

set local role authenticated;

-- Create (as Sade) -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);

select lives_ok($$
  select set_config('tests.activity', public.save_activity(
    '{"title": "Planning meeting", "activity_date": "2026-11-03", "start_time": "10:00", "end_time": "11:00",
      "location": "Room 2"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "collaborator"},
      {"contact_id": "00000000-0000-4000-8000-000000000c01", "role": "notify_only"}]')::text, true)
$$, 'staff can create an activity and its people in one call');

select is((select timezone from public.activities where id = current_setting('tests.activity')::uuid),
          'Africa/Lagos', 'the office time zone is used when none is given');
select is((select starts_at from public.activities where id = current_setting('tests.activity')::uuid),
          '2026-11-03 09:00+00'::timestamptz, 'the start time is converted from Lagos time');
select set_eq(
  $$ select coalesce(profile_id, contact_id)::text || ':' || role from public.activity_recipients
      where activity_id = current_setting('tests.activity')::uuid $$,
  array['00000000-0000-4000-8000-0000000000f1:responsible',
        '00000000-0000-4000-8000-0000000000f2:collaborator',
        '00000000-0000-4000-8000-000000000c01:notify_only'],
  'the people are saved with their roles');
select is((select version from public.activities where id = current_setting('tests.activity')::uuid),
          1, 'a new activity starts at version 1');

-- Edit with optimistic concurrency -----------------------------------------------------------
select lives_ok(format($$
  select public.save_activity(
    '{"id": "%s", "title": "Planning meeting (moved)", "activity_date": "2026-11-04", "start_time": "10:00",
      "end_time": "11:00", "location": "Room 2"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "collaborator"},
      {"contact_id": "00000000-0000-4000-8000-000000000c01", "role": "notify_only"}]', 1)
$$, current_setting('tests.activity')), 'editing from the current version works');
select is((select version from public.activities where id = current_setting('tests.activity')::uuid),
          2, 'saving bumps the version');
select is((select starts_at from public.activities where id = current_setting('tests.activity')::uuid),
          '2026-11-04 09:00+00'::timestamptz, 'rescheduling through save recomputes the start');
select throws_ok(format($$
  select public.save_activity('{"id": "%s", "title": "Stale edit", "activity_date": "2026-11-05"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"}]', 1)
$$, current_setting('tests.activity')),
  '40001', 'This activity was changed by someone else while you were editing it',
  'a save based on an old version is rejected');
select throws_ok(format($$
  select public.save_activity('{"id": "%s", "title": "No version", "activity_date": "2026-11-05"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"}]')
$$, current_setting('tests.activity')),
  '22023', 'The version being edited is required', 'an edit must say which version it started from');

-- Saving unchanged details writes no audit noise ---------------------------------------------
select lives_ok(format($$
  select public.save_activity(
    '{"id": "%s", "title": "Planning meeting (moved)", "activity_date": "2026-11-04", "start_time": "10:00",
      "end_time": "11:00", "location": "Room 2"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "collaborator"},
      {"contact_id": "00000000-0000-4000-8000-000000000c01", "role": "notify_only"}]', 2)
$$, current_setting('tests.activity')), 'saving unchanged details succeeds');

reset role;
select is((select count(*)::int from public.audit_logs
            where (table_name = 'activities' and record_id = current_setting('tests.activity'))
               or (table_name = 'activity_recipients'
                   and coalesce(new_data, old_data) ->> 'activity_id' = current_setting('tests.activity'))),
          5, 'only real changes are audited (1 create + 1 edit + 3 people)');
set local role authenticated;

-- Handing over responsibility (version is now 3) ----------------------------------------------
select lives_ok(format($$
  select public.save_activity(
    '{"id": "%s", "title": "Planning meeting (moved)", "activity_date": "2026-11-04", "start_time": "10:00"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "collaborator"}]', 3)
$$, current_setting('tests.activity')), 'the responsible person can be changed in one save');
select is((select profile_id from public.activity_recipients
            where activity_id = current_setting('tests.activity')::uuid and role = 'responsible'),
          '00000000-0000-4000-8000-0000000000f2'::uuid, 'Tunde is now responsible');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);

select lives_ok(format($$
  select public.save_activity(
    '{"id": "%s", "title": "Planning meeting (moved)", "activity_date": "2026-11-04", "start_time": "10:00"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f3", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "collaborator"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "collaborator"}]', 4)
$$, current_setting('tests.activity')), 'a responsible person (not the creator) can hand over to someone else');
select throws_ok(format($$
  select public.save_activity('{"id": "%s", "title": "Tunde again", "activity_date": "2026-11-04"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "responsible"}]', 5)
$$, current_setting('tests.activity')),
  '42501', null, 'after handing over, they can no longer edit it');
select throws_ok(format($$
  select public.set_activity_recipients('%s',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "responsible"}]')
$$, current_setting('tests.activity')),
  '42501', 'Activity not found, or you do not have permission to edit it',
  'calling the people function directly is permission-checked too');

-- Validation (as Sade; each attempt is a create, so nothing must be left behind) ------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);

select throws_ok($$
  select public.save_activity('{"title": "Should not exist", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "collaborator"}]')
$$, '22023', 'An activity needs exactly one responsible person', 'an activity needs a responsible person');
select is((select count(*)::int from public.activities where title = 'Should not exist'),
          0, 'a failed save leaves nothing behind (the activity is not created)');
select throws_ok($$
  select public.save_activity('{"title": "Two leads", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "responsible"}]')
$$, '22023', 'An activity needs exactly one responsible person', 'an activity cannot have two responsible people');
select throws_ok($$
  select public.save_activity('{"title": "Twice", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "collaborator"}]')
$$, '22023', 'Each person can be listed only once', 'the same person cannot be listed twice');
select throws_ok($$
  select public.save_activity('{"title": "Both", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f2", "contact_id": "00000000-0000-4000-8000-000000000c01",
       "role": "collaborator"}]')
$$, '22023', 'Each person must be either a staff member or an external contact',
   'an entry cannot be both a staff member and a contact');
select throws_ok($$
  select public.save_activity('{"title": "Former staff", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"profile_id": "00000000-0000-4000-8000-0000000000f4", "role": "collaborator"}]')
$$, '22023', 'These people cannot be added because they are inactive or unknown: Ifeoma Former',
   'deactivated staff cannot be added');
select throws_ok($$
  select public.save_activity('{"title": "Inactive contact", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
      {"contact_id": "00000000-0000-4000-8000-000000000c02", "role": "notify_only"}]')
$$, '22023', 'These people cannot be added because they are inactive or unknown: Former Partner',
   'inactive contacts cannot be added');
select throws_ok($$
  select public.save_activity('{"title": "Bad role", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "boss"}]')
$$, '22P02', null, 'an unknown role is rejected');
select throws_ok($$
  select public.save_activity('{"title": "   ", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"}]')
$$, '23514', null, 'field rules still apply (blank title)');
select throws_ok($$
  select public.save_activity('"not an object"', '[]')
$$, '22023', 'Activity details must be given as a JSON object', 'malformed input is rejected');

-- Deactivated staff cannot create ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f4", "role": "authenticated"}', true);
select throws_ok($$
  select public.save_activity('{"title": "Still here", "activity_date": "2026-11-06"}',
    '[{"profile_id": "00000000-0000-4000-8000-0000000000f4", "role": "responsible"}]')
$$, '42501', null, 'deactivated staff cannot create activities');

-- Status changes (version is now 5) ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);

select throws_ok(format($$ select public.set_activity_status('%s', 'cancelled', '  ', 5) $$, current_setting('tests.activity')),
  '22023', 'Give a reason for cancelling the activity', 'cancelling needs a reason');
select is(public.set_activity_status(current_setting('tests.activity')::uuid, 'cancelled', 'Host unavailable', 5),
          6, 'cancelling returns the new version');
select results_eq(
  format($$ select status::text, status_reason from public.activities where id = '%s' $$, current_setting('tests.activity')),
  $$ values ('cancelled', 'Host unavailable') $$,
  'the activity is cancelled with its reason');
select throws_ok(format($$ select public.set_activity_status('%s', 'completed', null, 6) $$, current_setting('tests.activity')),
  '22023', 'Reopen the activity before changing it to completed', 'a cancelled activity cannot jump to completed');
select throws_ok(format($$ select public.set_activity_status('%s', 'scheduled', null, 5) $$, current_setting('tests.activity')),
  '40001', 'This activity was changed by someone else while you were editing it', 'a stale status change is rejected');
select is(public.set_activity_status(current_setting('tests.activity')::uuid, 'scheduled', null, 6),
          7, 'a cancelled activity can be reopened');
select is((select status_reason from public.activities where id = current_setting('tests.activity')::uuid),
          null::text, 'reopening clears the reason');
select throws_ok(format($$ select public.set_activity_status('%s', 'scheduled') $$, current_setting('tests.activity')),
  '22023', 'The activity is already scheduled', 'a no-op status change is rejected');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);
select throws_ok(format($$ select public.set_activity_status('%s', 'completed') $$, current_setting('tests.activity')),
  '42501', null, 'a collaborator cannot change the status');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}', true);
select is(public.set_activity_status(current_setting('tests.activity')::uuid, 'completed', 'Agreed next steps', 7),
          8, 'the responsible person can mark it completed');

-- Office info ---------------------------------------------------------------------------------
select results_eq($$ select office_name, timezone from public.office_info() $$,
                  $$ values ('Office'::text, 'Africa/Lagos'::text) $$,
                  'active staff can read the office name and time zone');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f4", "role": "authenticated"}', true);
select is((select count(*)::int from public.office_info()), 0, 'deactivated staff get nothing from office_info');

reset role;
select ok(not has_function_privilege('anon', 'public.save_activity(jsonb, jsonb, integer)', 'EXECUTE'),
          'anonymous visitors cannot call save_activity');
select ok(not has_function_privilege('anon', 'public.office_info()', 'EXECUTE'),
          'anonymous visitors cannot call office_info');
select ok(not has_function_privilege('anon', 'public.set_activity_status(uuid, public.activity_status, text, integer)', 'EXECUTE'),
          'anonymous visitors cannot call set_activity_status');

select * from finish();
rollback;
