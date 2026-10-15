-- Schema smoke tests: tables exist, RLS is on everywhere, API roles hold only intended privileges.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'contacts', 'contacts table exists');
select has_table('public', 'activities', 'activities table exists');
select has_table('public', 'activity_recipients', 'activity_recipients table exists');
select has_table('public', 'notification_jobs', 'notification_jobs table exists');
select has_table('public', 'notification_logs', 'notification_logs table exists');
select has_table('public', 'system_settings', 'system_settings table exists');
select has_table('public', 'audit_logs', 'audit_logs table exists');

select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null::text[],
  'every table in public has row level security enabled'
);

select ok(not has_table_privilege('anon', 'public.profiles',            'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to profiles');
select ok(not has_table_privilege('anon', 'public.contacts',            'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to contacts');
select ok(not has_table_privilege('anon', 'public.activities',          'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to activities');
select ok(not has_table_privilege('anon', 'public.activity_recipients', 'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to activity_recipients');
select ok(not has_table_privilege('anon', 'public.notification_jobs',   'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to notification_jobs');
select ok(not has_table_privilege('anon', 'public.notification_logs',   'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to notification_logs');
select ok(not has_table_privilege('anon', 'public.system_settings',     'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to system_settings');
select ok(not has_table_privilege('anon', 'public.audit_logs',          'SELECT, INSERT, UPDATE, DELETE'), 'anon has no access to audit_logs');

select ok(not has_table_privilege('authenticated', 'public.audit_logs',        'INSERT, UPDATE, DELETE, TRUNCATE'), 'signed-in users cannot write the audit log directly');
select ok(not has_table_privilege('service_role',  'public.audit_logs',        'INSERT, UPDATE, DELETE, TRUNCATE'), 'even the service role cannot write the audit log directly');
select ok(not has_table_privilege('authenticated', 'public.notification_jobs', 'INSERT, UPDATE, DELETE, TRUNCATE'), 'signed-in users cannot write notification jobs');
select ok(not has_table_privilege('authenticated', 'public.notification_logs', 'INSERT, UPDATE, DELETE, TRUNCATE'), 'signed-in users cannot write notification logs');

select ok(not has_function_privilege('anon',          'public.audit_row_change()',     'EXECUTE'), 'anon cannot call the audit trigger function');
select ok(not has_function_privilege('authenticated', 'public.audit_row_change()',     'EXECUTE'), 'signed-in users cannot call the audit trigger function');
select ok(not has_function_privilege('anon',          'public.handle_new_auth_user()', 'EXECUTE'), 'anon cannot call the profile-creation function');
select ok(not has_function_privilege('authenticated', 'public.handle_new_auth_user()', 'EXECUTE'), 'signed-in users cannot call the profile-creation function');

select is((select count(*)::int from public.system_settings), 1, 'system_settings has exactly one row');

select * from finish();
rollback;
