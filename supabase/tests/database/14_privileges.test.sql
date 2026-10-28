-- Privilege allowlist: exactly what anonymous visitors and signed-in users may call or touch in
-- the public schema. Everything else is for the server (service role) only.
--
-- A new function or table fails this test until it is added here on purpose. When that happens:
-- revoke from public, anon (and authenticated, unless signed-in users really need it), and if
-- they do, make sure the function checks the caller itself (is_admin(), can_edit_activity(), ...).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
-- Signatures below are written without the schema, as regprocedure prints them on this path.
set local search_path = public, extensions;

create temporary view fn as
select p.oid, p.oid::regprocedure::text as signature, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public';

-- Functions ------------------------------------------------------------------------------------
select is_empty(
  $$ select signature from fn where has_function_privilege('anon', oid, 'EXECUTE') $$,
  'anonymous visitors can call no database function');

select set_eq(
  $$ select signature from fn where has_function_privilege('authenticated', oid, 'EXECUTE') $$,
  array[
    -- Permission checks used by RLS policies and the app.
    'is_active_staff()', 'is_admin()', 'is_activity_recipient(uuid)', 'is_activity_responsible(uuid)',
    'can_view_activity(uuid)', 'can_edit_activity(uuid)',
    -- Activities: each checks the caller (invokers run under RLS; definers check explicitly).
    'save_activity(jsonb,jsonb,integer)', 'set_activity_recipients(uuid,jsonb)',
    'set_activity_status(uuid,activity_status,text,integer)', 'activity_history(uuid)', 'office_info()',
    -- Administrators only (checked inside).
    'queue_test_notification()', 'cancel_notification_job(uuid)', 'retry_notification_job(uuid)'
  ],
  'signed-in users can call exactly the functions meant for them');

select is_empty(
  $$ select signature from fn
      where prosecdef
        and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%') $$,
  'every security definer function pins its search_path');

-- Tables, views and sequences --------------------------------------------------------------------
select is_empty(
  $$ select table_name || ': ' || privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' $$,
  'anonymous visitors have no rights on any table');

select set_eq(
  $$ select table_name || ': ' || privilege_type
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'authenticated' $$,
  array[
    'activities: SELECT', 'activities: INSERT', 'activities: UPDATE',
    'activity_recipients: SELECT', 'activity_recipients: INSERT', 'activity_recipients: UPDATE', 'activity_recipients: DELETE',
    'contacts: SELECT', 'contacts: INSERT', 'contacts: UPDATE',
    'profiles: SELECT', 'profiles: UPDATE',
    'system_settings: SELECT', 'system_settings: UPDATE',
    -- Read-only, and RLS limits them further (admins; editors see their activities' reminders).
    'notification_jobs: SELECT', 'notification_logs: SELECT', 'audit_logs: SELECT'
  ],
  'signed-in users have exactly the table rights meant for them (RLS then decides which rows)');

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table has row level security on');

-- A view runs with its owner's rights unless it is security_invoker, which would bypass RLS.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')
        and not coalesce('security_invoker=true' = any (c.reloptions), false) $$,
  'no view bypasses row level security');

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'S'
        and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE')) $$,
  'no sequence is usable directly by API roles');

select ok(not has_schema_privilege('anon', 'public', 'CREATE') and not has_schema_privilege('authenticated', 'public', 'CREATE'),
          'API roles cannot create objects in the public schema');

-- Objects that later migrations (run as postgres) create start closed to the API roles: checked by
-- creating some here (rolled back at the end).
set local role postgres;
create table public.zz_privilege_probe (id integer);
create function public.zz_privilege_probe_fn() returns integer language sql as 'select 1';
create sequence public.zz_privilege_probe_seq;
reset role;
select is_empty(
  $$ select r.rolname || ': ' || o.what
       from (values ('anon'), ('authenticated')) r(rolname)
       cross join lateral (values
         ('table', has_table_privilege(r.rolname, 'public.zz_privilege_probe', 'SELECT,INSERT,UPDATE,DELETE')),
         ('function', has_function_privilege(r.rolname, 'public.zz_privilege_probe_fn()', 'EXECUTE')),
         ('sequence', has_sequence_privilege(r.rolname, 'public.zz_privilege_probe_seq', 'USAGE,SELECT,UPDATE'))
       ) o(what, granted)
      where o.granted $$,
  'a new table, function or sequence gives the API roles nothing until a migration grants it');

select * from finish();
rollback;
