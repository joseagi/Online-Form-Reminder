-- Audit trail behaviour, and protection of the audit log itself.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'ada@example.com', '{"full_name": "Ada Obi"}');

select results_eq(
  $$ select actor_id from public.audit_logs
      where action = 'profiles.insert' and record_id = '00000000-0000-4000-8000-0000000000a1' $$,
  $$ values (null::uuid) $$,
  'profile creation by the Auth trigger is audited once, as a system action');

select set_config('request.jwt.claims',
                  '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}', true);

insert into public.activities (id, title, activity_date, created_by) values
  ('00000000-0000-4000-8000-0000000000e1', 'Audit me', '2026-11-02', '00000000-0000-4000-8000-0000000000a1');

select is((select count(*)::int from public.audit_logs
            where action = 'activities.insert' and record_id = '00000000-0000-4000-8000-0000000000e1'),
          1, 'creating an activity is audited');
select is((select actor_id from public.audit_logs
            where action = 'activities.insert' and record_id = '00000000-0000-4000-8000-0000000000e1'),
          '00000000-0000-4000-8000-0000000000a1'::uuid, 'the audit entry records the signed-in user');
select is((select new_data ->> 'title' from public.audit_logs
            where action = 'activities.insert' and record_id = '00000000-0000-4000-8000-0000000000e1'),
          'Audit me', 'the audit entry keeps the inserted values');
select ok((select not (new_data ? 'search') from public.audit_logs
            where action = 'activities.insert' and record_id = '00000000-0000-4000-8000-0000000000e1'),
          'the derived search vector is not copied into the audit log');

update public.activities set title = 'Audit me (renamed)' where id = '00000000-0000-4000-8000-0000000000e1';
select is((select changed_fields from public.audit_logs
            where action = 'activities.update' and record_id = '00000000-0000-4000-8000-0000000000e1'),
          array['title'], 'an update records exactly which fields changed');
select is((select old_data ->> 'title' from public.audit_logs
            where action = 'activities.update' and record_id = '00000000-0000-4000-8000-0000000000e1'),
          'Audit me', 'an update keeps the previous value');

update public.activities set title = title where id = '00000000-0000-4000-8000-0000000000e1';
select is((select count(*)::int from public.audit_logs
            where action = 'activities.update' and record_id = '00000000-0000-4000-8000-0000000000e1'),
          1, 'a no-op update writes no audit entry');

update public.system_settings set weekly_summary_send_time = '18:00';
select is((select changed_fields from public.audit_logs
            where action = 'system_settings.update' order by id desc limit 1),
          array['weekly_summary_send_time'], 'settings changes are audited field by field');

-- The audit log is read-only for staff, and append-only for every API role ---------------
set local role authenticated;

select is((select count(*)::int from public.audit_logs), 0,
          'staff cannot read the audit log');
select throws_ok(
  $$ update public.audit_logs set action = 'tampered' $$,
  '42501', null, 'signed-in users cannot alter audit entries');
select throws_ok(
  $$ insert into public.audit_logs (action) values ('forged') $$,
  '42501', null, 'signed-in users cannot forge audit entries');
select throws_ok(
  $$ delete from public.audit_logs $$,
  '42501', null, 'signed-in users cannot delete audit entries');

reset role;
set local role service_role;

select throws_ok(
  $$ update public.audit_logs set action = 'tampered' $$,
  '42501', null, 'the service role cannot alter audit entries');

reset role;

select * from finish();
rollback;
