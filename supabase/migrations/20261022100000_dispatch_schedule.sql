-- Phase 4b: run the notification dispatcher every 5 minutes with Supabase Cron.
--
-- The dispatcher's address and shared secret are kept in Vault and set per environment with
-- public.configure_dispatch() (locally: `npm run dispatch:setup`), never in source control.
-- Until they are set, the scheduled job only plans and calls nothing.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Stores (or replaces) where the dispatcher lives and the secret it expects.
create function public.configure_dispatch(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_url is null or p_url !~ '^https?://' or p_secret is null or length(p_secret) < 32 then
    raise exception 'A web address and a secret of at least 32 characters are required' using errcode = '22023';
  end if;

  select id into v_id from vault.secrets where name = 'dispatch_url';
  if v_id is null then
    perform vault.create_secret(p_url, 'dispatch_url', 'Notification dispatcher Edge Function URL');
  else
    perform vault.update_secret(v_id, p_url);
  end if;

  select id into v_id from vault.secrets where name = 'dispatch_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'dispatch_secret', 'Shared secret sent to the dispatcher');
  else
    perform vault.update_secret(v_id, p_secret);
  end if;
end;
$$;

revoke execute on function public.configure_dispatch(text, text) from public, anon, authenticated;
grant execute on function public.configure_dispatch(text, text) to service_role;

-- Every 5 minutes: plan in the database (works even if the dispatcher is unreachable), then call
-- the dispatcher. pg_net sends the request in the background; the 60-second timeout covers a full
-- batch. pg_cron never overlaps runs of the same job.
select cron.schedule(
  'dispatch-notifications',
  '*/5 * * * *',
  $job$
    select public.plan_weekly_summaries();
    select net.http_post(
             url := (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_url'),
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')),
             body := '{}'::jsonb,
             timeout_milliseconds := 60000)
     where exists (select 1 from vault.decrypted_secrets where name = 'dispatch_url');
  $job$
);

-- Weekly housekeeping (Sundays 03:30 GMT): cron's run history is never cleaned automatically, and
-- the dispatcher writes two heartbeat entries per run.
select cron.schedule(
  'clean-dispatch-history',
  '30 3 * * 0',
  $job$
    delete from cron.job_run_details where end_time < now() - interval '14 days';
    delete from public.notification_logs where job_id is null and created_at < now() - interval '30 days';
  $job$
);
