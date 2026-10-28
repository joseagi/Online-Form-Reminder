-- Stage 6b: reminder_details also returns the activity's start instant, so a reminder for an
-- activity in another time zone can give the office-time equivalent (correct across clock changes
-- in either zone). Same as in 20261024090000_day_before_reminders.sql otherwise; a function's
-- result columns can't be changed in place, so it is dropped and created again.
drop function public.reminder_details(uuid, timestamptz);

create function public.reminder_details(p_job_id uuid, p_now timestamptz default now())
returns table (
  problem            text,
  activity_id        uuid,
  title              text,
  description        text,
  activity_date      date,
  start_time         time,
  end_time           time,
  timezone           text,
  location           text,
  meeting_url        text,
  contact_name       text,
  contact_phone      text,
  contact_email      text,
  preparation_notes  text,
  recipient_name     text,
  recipient_role     public.recipient_role,
  recipient_is_staff boolean,
  responsible_name   text,
  others             text[],  -- collaborators other than the recipient
  starts_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select public.reminder_job_problem(j, p_now),
         a.id, a.title, a.description, a.activity_date, a.start_time, a.end_time, a.timezone,
         a.location, a.meeting_url, a.contact_name, a.contact_phone, a.contact_email::text, a.preparation_notes,
         coalesce(p.full_name, c.full_name), r.role, j.profile_id is not null,
         (select rp.full_name
            from public.activity_recipients rr
            join public.profiles rp on rp.id = rr.profile_id
           where rr.activity_id = a.id and rr.role = 'responsible'),
         coalesce((select array_agg(coalesce(op.full_name, oc.full_name) order by coalesce(op.full_name, oc.full_name))
                     from public.activity_recipients o
                     left join public.profiles op on op.id = o.profile_id
                     left join public.contacts oc on oc.id = o.contact_id
                    where o.activity_id = a.id
                      and o.role = 'collaborator'
                      and not (o.profile_id is not distinct from j.profile_id
                               and o.contact_id is not distinct from j.contact_id)), '{}'),
         a.starts_at
    from public.notification_jobs j
    left join public.activities a on a.id = j.activity_id
    left join public.activity_recipients r
           on r.activity_id = j.activity_id
          and (r.profile_id = j.profile_id or r.contact_id = j.contact_id)
    left join public.profiles p on p.id = j.profile_id
    left join public.contacts c on c.id = j.contact_id
   where j.id = p_job_id
     and j.kind = 'day_before_reminder';
$$;

revoke execute on function public.reminder_details(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reminder_details(uuid, timestamptz) to service_role;
