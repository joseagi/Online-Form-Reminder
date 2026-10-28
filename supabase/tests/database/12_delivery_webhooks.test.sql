-- Delivery reports from Resend webhooks: recorded once each, matched to their message, and never
-- moving a message's delivery status backwards.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Two messages Resend accepted, and one only logged (same provider id, different provider).
insert into public.notification_jobs
  (id, kind, channel, dedupe_key, destination, scheduled_for, run_after, status, provider, provider_message_id, accepted_at, send_mode)
values
  ('00000000-0000-4000-8000-0000000000c1', 'test', 'email', 'test:email:c1', 'ada@office.dev', now(), now(), 'sent', 'resend', 'em-1', now(), 'test'),
  ('00000000-0000-4000-8000-0000000000c2', 'test', 'email', 'test:email:c2', 'bola@office.dev', now(), now(), 'sent', 'resend', 'em-2', now(), 'test'),
  ('00000000-0000-4000-8000-0000000000c3', 'test', 'email', 'test:email:c3', 'chi@office.dev', now(), now(), 'sent', 'log', 'em-3', now(), 'test');

create function pg_temp.delivery(p_job uuid) returns text language sql as $$
  select delivery_status::text from public.notification_jobs where id = p_job
$$;

-- Delivered.
select is(public.record_delivery_event('resend', 'msg_1', 'email.delivered', 'em-1', '2026-10-28 10:00:00+00'),
          'recorded', 'a delivery report is recorded');
select is(pg_temp.delivery('00000000-0000-4000-8000-0000000000c1'), 'delivered', 'and marks the message delivered');
select is((select delivery_updated_at from public.notification_jobs where id = '00000000-0000-4000-8000-0000000000c1'),
          '2026-10-28 10:00:00+00'::timestamptz, 'as of the time Resend reports');
select results_eq(
  $$ select job_id::text, event, provider, provider_message_id, details->>'occurred_at'
       from public.notification_logs where provider_event_id = 'msg_1' $$,
  $$ values ('00000000-0000-4000-8000-0000000000c1', 'email.delivered', 'resend', 'em-1', '2026-10-28T10:00:00+00:00') $$,
  'the report is in the message''s history');

-- Resend retries a webhook with the same svix-id.
select is(public.record_delivery_event('resend', 'msg_1', 'email.delivered', 'em-1', '2026-10-28 10:00:00+00'),
          'duplicate', 'a redelivered report is recognised');
select is((select count(*)::int from public.notification_logs where provider_event_id = 'msg_1'), 1, 'and recorded only once');

-- Reports out of order.
select is(public.record_delivery_event('resend', 'msg_2', 'email.delivery_delayed', 'em-1', '2026-10-28 09:59:00+00'),
          'recorded', 'a late "delayed" report is still recorded');
select is(pg_temp.delivery('00000000-0000-4000-8000-0000000000c1'), 'delivered', 'but does not undo "delivered"');
select is(public.record_delivery_event('resend', 'msg_3', 'email.complained', 'em-1', '2026-10-28 11:00:00+00'),
          'recorded', 'a spam complaint after delivery is recorded');
select is(pg_temp.delivery('00000000-0000-4000-8000-0000000000c1'), 'complained', 'and wins over "delivered"');
select is(public.record_delivery_event('resend', 'msg_4', 'email.sent', 'em-1', '2026-10-28 09:58:00+00'),
          'recorded', 'other email events are only logged');
select is(pg_temp.delivery('00000000-0000-4000-8000-0000000000c1'), 'complained', 'without changing the status');

-- Delayed, then bounced, with the receiving server's reason.
select public.record_delivery_event('resend', 'msg_5', 'email.delivery_delayed', 'em-2', now());
select public.record_delivery_event('resend', 'msg_6', 'email.bounced', 'em-2', now(), 'Permanent',
                                    'smtp; 550 5.1.1 mailbox unavailable', '{"sub_type": "General"}');
select is(pg_temp.delivery('00000000-0000-4000-8000-0000000000c2'), 'bounced', 'a bounce after a delay marks the message bounced');
select results_eq(
  $$ select error_code, error_message, details->>'sub_type' from public.notification_logs where provider_event_id = 'msg_6' $$,
  $$ values ('Permanent', 'smtp; 550 5.1.1 mailbox unavailable', 'General') $$,
  'with the reason in its history');

-- Reports for messages this system did not send through Resend.
select is(public.record_delivery_event('resend', 'msg_7', 'email.delivered', 'em-3'),
          'unknown_message', 'a report is matched on provider and id together');
select ok((select job_id is null from public.notification_logs where provider_event_id = 'msg_7')
          and pg_temp.delivery('00000000-0000-4000-8000-0000000000c3') = 'unknown',
          'an unmatched report is logged without a message');

select throws_ok($$ select public.record_delivery_event('resend', '', 'email.delivered', 'em-1') $$, '22023', null,
                 'a report without an id is refused');

select ok(not has_function_privilege('authenticated', 'public.record_delivery_event(text, text, text, text, timestamptz, text, text, jsonb)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.record_delivery_event(text, text, text, text, timestamptz, text, text, jsonb)', 'EXECUTE'),
          'only the server (service role) can record delivery reports');

select * from finish();
rollback;
