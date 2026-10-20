-- activity_history: what happened to an activity, for those allowed to see it.
--   Sade (f1) creates a RESTRICTED activity with Tunde (f2) as collaborator, renames it,
--   removes Tunde, then cancels it. Uche (f3) is never involved.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'sade@example.com',  '{"full_name": "Sade Staff"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'tunde@example.com', '{"full_name": "Tunde Staff"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'uche@example.com',  '{"full_name": "Uche Staff"}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);

select set_config('tests.activity', public.save_activity(
  '{"title": "Salary review", "activity_date": "2026-11-20", "visibility": "restricted"}',
  '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"},
    {"profile_id": "00000000-0000-4000-8000-0000000000f2", "role": "collaborator"}]')::text, true);

-- While Tunde is still on it, he can read the history too.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);
select is((select count(*)::int from public.activity_history(current_setting('tests.activity')::uuid)),
          3, 'a person on the activity can read its history');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
select public.save_activity(
  format('{"id": "%s", "title": "Salary review 2027", "activity_date": "2026-11-20", "visibility": "restricted"}',
         current_setting('tests.activity'))::jsonb,
  '[{"profile_id": "00000000-0000-4000-8000-0000000000f1", "role": "responsible"}]', 1);
select public.set_activity_status(current_setting('tests.activity')::uuid, 'cancelled', 'Postponed to January');

select results_eq(
  format($$ select entity, operation, coalesce(person_name, '-'), actor_name
              from public.activity_history('%s') $$, current_setting('tests.activity')),
  $$ values ('activity', 'insert', '-', 'Sade Staff'),
            ('person', 'insert', 'Sade Staff', 'Sade Staff'),
            ('person', 'insert', 'Tunde Staff', 'Sade Staff'),
            ('activity', 'update', '-', 'Sade Staff'),
            ('person', 'delete', 'Tunde Staff', 'Sade Staff'),
            ('activity', 'update', '-', 'Sade Staff') $$,
  'the history lists every change in order, with who made it');

select is((select changed_fields from public.activity_history(current_setting('tests.activity')::uuid)
            where entity = 'activity' and operation = 'update' order by id limit 1),
          array['title'], 'a rename records only the title as changed');
select is((select old_data ->> 'title' from public.activity_history(current_setting('tests.activity')::uuid)
            where entity = 'activity' and operation = 'update' order by id limit 1),
          'Salary review', 'the previous value is available');
select ok((select changed_fields @> array['status', 'status_reason']
             from public.activity_history(current_setting('tests.activity')::uuid)
            where entity = 'activity' and operation = 'update' order by id desc limit 1),
          'cancelling records the status and the reason');
select is((select new_data ->> 'status_reason' from public.activity_history(current_setting('tests.activity')::uuid)
            where entity = 'activity' order by id desc limit 1),
          'Postponed to January', 'the cancellation reason is in the history');

-- Removed from a restricted activity, Tunde loses its history along with the activity.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f2", "role": "authenticated"}', true);
select is((select count(*)::int from public.activity_history(current_setting('tests.activity')::uuid)),
          0, 'someone removed from a restricted activity can no longer read its history');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f3", "role": "authenticated"}', true);
select is((select count(*)::int from public.activity_history(current_setting('tests.activity')::uuid)),
          0, 'uninvolved staff get no history for a restricted activity');

reset role;
select ok(not has_function_privilege('anon', 'public.activity_history(uuid)', 'EXECUTE'),
          'anonymous visitors cannot call activity_history');
select has_index('public', 'audit_logs', 'audit_logs_recipient_activity_idx',
                 'people changes are indexed by activity');

select * from finish();
rollback;
