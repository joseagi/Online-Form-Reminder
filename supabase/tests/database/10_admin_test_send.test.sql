-- "Send test to me": administrators only, to their own address, rate limited.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f0', 'amaka@example.com', '{"full_name": "Amaka Admin"}'),
  ('00000000-0000-4000-8000-0000000000f1', 'sade@example.com',  '{"full_name": "Sade Staff"}');
update public.profiles set role = 'admin' where id = '00000000-0000-4000-8000-0000000000f0';

set local role authenticated;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f1", "role": "authenticated"}', true);
select throws_ok($$ select public.queue_test_notification() $$, '42501',
                 'Only administrators can send test messages', 'staff cannot send test messages');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000f0", "role": "authenticated"}', true);
select set_config('tests.job', public.queue_test_notification()::text, true);

reset role;
select results_eq(
  format($$ select kind::text, destination, status::text, profile_id::text from public.notification_jobs where id = '%s' $$,
         current_setting('tests.job')),
  $$ values ('test', 'amaka@example.com', 'pending', '00000000-0000-4000-8000-0000000000f0') $$,
  'the test goes to the administrator''s own address, ready to send');
select ok((select run_after <= now() and expires_at = now() + interval '1 hour'
             from public.notification_jobs where id = current_setting('tests.job')::uuid),
          'it is due immediately and expires after an hour');
select is((select extract(isodow from period_start)::int from public.notification_jobs where id = current_setting('tests.job')::uuid),
          1, 'it previews a week starting on a Monday');
select ok((select period_start > (now() at time zone 'Africa/Lagos')::date
                  and period_start <= (now() at time zone 'Africa/Lagos')::date + 7
             from public.notification_jobs where id = current_setting('tests.job')::uuid),
          'the week is the one the coming Sunday''s summary covers');
select ok((select dedupe_key like 'test:email:%' from public.notification_jobs where id = current_setting('tests.job')::uuid),
          'each test has its own key, so tests never collide with real summaries');

set local role authenticated;
select public.queue_test_notification() from generate_series(1, 4);
select throws_ok($$ select public.queue_test_notification() $$, '22023', null,
                 'a sixth test within the hour is refused');

reset role;
select ok(not has_function_privilege('anon', 'public.queue_test_notification()', 'EXECUTE'),
          'anonymous visitors cannot send test messages');
select ok(not has_function_privilege('authenticated', 'public.request_dispatch()', 'EXECUTE'),
          'signed-in users cannot trigger the dispatcher directly');

select * from finish();
rollback;
