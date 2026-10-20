-- The dispatcher's schedule and its Vault configuration.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select results_eq(
  $$ select schedule, active from cron.job where jobname = 'dispatch-notifications' $$,
  $$ values ('*/5 * * * *'::text, true) $$,
  'the dispatcher is scheduled every 5 minutes');
select ok((select command from cron.job where jobname = 'dispatch-notifications') like '%plan_notifications%',
          'each scheduled run plans summaries and reminders in the database first');
select results_eq(
  $$ select schedule from cron.job where jobname = 'clean-dispatch-history' $$,
  $$ values ('30 3 * * 0'::text) $$,
  'old run history is cleaned up weekly');

select throws_ok(
  $$ select public.configure_dispatch('http://kong:8000/functions/v1/dispatch-notifications', 'too-short') $$,
  '22023', null, 'a short secret is refused');

select lives_ok(
  $$ select public.configure_dispatch('http://kong:8000/functions/v1/dispatch-notifications', repeat('a', 40)) $$,
  'the dispatcher address and secret can be stored');
select lives_ok(
  $$ select public.configure_dispatch('http://kong:8000/functions/v1/dispatch-notifications', repeat('b', 40)) $$,
  'and replaced');
-- (Vault's columns use their own collation, hence the explicit COLLATE for comparisons.)
select is((select count(*)::int from vault.decrypted_secrets where name in ('dispatch_url', 'dispatch_secret')),
          2, 'Vault holds exactly one entry for each');
select is((select decrypted_secret collate "default" from vault.decrypted_secrets where name = 'dispatch_secret'),
          repeat('b', 40), 'the secret was replaced, not duplicated');

select ok(not has_function_privilege('authenticated', 'public.configure_dispatch(text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.configure_dispatch(text, text)', 'EXECUTE'),
          'only the service role can configure the dispatcher');

select * from finish();
rollback;
