-- Stage 5c: delivery reports from the email provider. Resend calls the resend-webhook Edge
-- Function (signed with Svix); the function checks the signature and records the report here.
-- "sent" means the provider accepted the message; delivery_status says what happened next.

-- How far along a message is. A report never moves a message back: a late "delayed" does not
-- undo "delivered", and nothing undoes a bounce, a failure, a suppression or a spam complaint.
create function public.delivery_status_rank(p_status public.delivery_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
           when 'unknown'    then 0
           when 'delayed'    then 1
           when 'delivered'  then 2
           when 'bounced'    then 3
           when 'failed'     then 3
           when 'suppressed' then 3
           when 'complained' then 4
         end;
$$;

-- Records one delivery report and returns what happened to it:
--   'recorded'         logged on its message (and the message's delivery status moved forward)
--   'duplicate'        this report (p_event_id, the svix-id) was recorded before: Resend sends the
--                      same id when it retries, so each report counts once
--   'unknown_message'  no message has this provider id (e.g. sent by something else on the same
--                      Resend account). Logged without a message, and cleared after 30 days.
-- Report types other than the six delivery outcomes (e.g. email.sent) are logged only.
create function public.record_delivery_event(
  p_provider            text,
  p_event_id            text,
  p_event_type          text,
  p_provider_message_id text,
  p_occurred_at         timestamptz default null,
  p_error_code          text default null,
  p_error_message       text default null,
  p_details             jsonb default '{}')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job    public.notification_jobs;
  v_status public.delivery_status;
  v_log_id bigint;
begin
  if coalesce(p_event_id, '') = '' or coalesce(p_provider_message_id, '') = '' or coalesce(p_event_type, '') !~ '^email\.' then
    raise exception 'A delivery report needs an id, an email.* type and a provider message id' using errcode = '22023';
  end if;

  v_status := case p_event_type
                when 'email.delivered'        then 'delivered'
                when 'email.delivery_delayed' then 'delayed'
                when 'email.bounced'          then 'bounced'
                when 'email.complained'       then 'complained'
                when 'email.failed'           then 'failed'
                when 'email.suppressed'       then 'suppressed'
              end::public.delivery_status;

  select * into v_job
    from public.notification_jobs
   where provider = p_provider and provider_message_id = p_provider_message_id
     for update;

  insert into public.notification_logs
    (job_id, event, provider, provider_message_id, provider_event_id, error_code, error_message, details)
  values
    (v_job.id, left(p_event_type, 60), p_provider, p_provider_message_id, p_event_id, p_error_code, left(p_error_message, 1000),
     coalesce(p_details, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('occurred_at', p_occurred_at)))
  on conflict (provider_event_id) do nothing
  returning id into v_log_id;

  if v_log_id is null then
    return 'duplicate';
  end if;
  if v_job.id is null then
    return 'unknown_message';
  end if;

  if v_status is not null
     and public.delivery_status_rank(v_status) > public.delivery_status_rank(v_job.delivery_status) then
    update public.notification_jobs
       set delivery_status     = v_status,
           delivery_updated_at = coalesce(p_occurred_at, now())
     where id = v_job.id;
  end if;
  return 'recorded';
end;
$$;

revoke execute on function
  public.delivery_status_rank(public.delivery_status),
  public.record_delivery_event(text, text, text, text, timestamptz, text, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.delivery_status_rank(public.delivery_status),
  public.record_delivery_event(text, text, text, text, timestamptz, text, text, jsonb)
to service_role;
