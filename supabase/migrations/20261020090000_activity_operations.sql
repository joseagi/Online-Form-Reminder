-- Activity operations used by the app: save an activity together with its people in one
-- transaction, change its status, and read the office's name and time zone.
--
-- Error codes the app relies on:
--   42501  not found, or not allowed (deliberately indistinguishable)
--   40001  someone else saved a newer version while this one was being edited
--   22023  invalid request (e.g. no responsible person)
-- plus the usual constraint codes (23xxx) for invalid field values.

-- Office name and time zone, for active staff (system_settings itself is admin-only).
create function public.office_info()
returns table (office_name text, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.office_name, s.timezone
    from public.system_settings s
   where public.is_active_staff();
$$;

-- Replace an activity's list of people with p_recipients: a JSON array of
--   { "profile_id" | "contact_id": uuid, "role": "responsible" | "collaborator" | "notify_only",
--     "notify_email"?: boolean (default true), "notify_whatsapp"?: boolean (default false) }
-- Only real changes are written, so an unchanged list leaves no audit entries.
create function public.set_activity_recipients(p_activity_id uuid, p_recipients jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_people      integer;
  v_distinct    integer;
  v_responsible integer;
  v_unavailable text;
begin
  -- Authorise once, before anything changes. (A responsible person who hands over to someone
  -- else stops being an editor part-way through; the handover itself is allowed.)
  if not exists (select 1 from public.activities where id = p_activity_id)
     or not public.can_edit_activity(p_activity_id) then
    raise exception 'Activity not found, or you do not have permission to edit it' using errcode = '42501';
  end if;

  if jsonb_typeof(p_recipients) is distinct from 'array' then
    raise exception 'People must be given as a JSON array' using errcode = '22023';
  end if;

  if exists (select 1
               from jsonb_to_recordset(p_recipients) as n(profile_id uuid, contact_id uuid)
              where num_nonnulls(n.profile_id, n.contact_id) <> 1) then
    raise exception 'Each person must be either a staff member or an external contact' using errcode = '22023';
  end if;

  select count(*),
         count(distinct coalesce(n.profile_id, n.contact_id)),
         count(*) filter (where n.role = 'responsible')
    into v_people, v_distinct, v_responsible
    from jsonb_to_recordset(p_recipients) as n(profile_id uuid, contact_id uuid, role public.recipient_role);

  if v_responsible <> 1 then
    raise exception 'An activity needs exactly one responsible person' using errcode = '22023';
  end if;
  if v_distinct <> v_people then
    raise exception 'Each person can be listed only once' using errcode = '22023';
  end if;

  -- Newly added people must be active. People already on the activity stay even if they have
  -- since left, so old activities can still be edited.
  select string_agg(coalesce(p.full_name, c.full_name, 'unknown person'), ', ')
    into v_unavailable
    from jsonb_to_recordset(p_recipients) as n(profile_id uuid, contact_id uuid)
    left join public.profiles p on p.id = n.profile_id
    left join public.contacts c on c.id = n.contact_id
   where coalesce(p.is_active, c.is_active) is not true
     and not exists (select 1 from public.activity_recipients r
                      where r.activity_id = p_activity_id
                        and r.profile_id is not distinct from n.profile_id
                        and r.contact_id is not distinct from n.contact_id);
  if v_unavailable is not null then
    raise exception 'These people cannot be added because they are inactive or unknown: %', v_unavailable
      using errcode = '22023';
  end if;

  -- 1. Remove people no longer listed.
  delete from public.activity_recipients r
   where r.activity_id = p_activity_id
     and not exists (select 1
                       from jsonb_to_recordset(p_recipients) as n(profile_id uuid, contact_id uuid)
                      where n.profile_id is not distinct from r.profile_id
                        and n.contact_id is not distinct from r.contact_id);

  -- 2-3. Update changed entries: demotions before promotions, so "at most one responsible
  --      person" holds after every statement.
  update public.activity_recipients r
     set role = n.role,
         notify_email = coalesce(n.notify_email, true),
         notify_whatsapp = coalesce(n.notify_whatsapp, false)
    from jsonb_to_recordset(p_recipients)
           as n(profile_id uuid, contact_id uuid, role public.recipient_role, notify_email boolean, notify_whatsapp boolean)
   where r.activity_id = p_activity_id
     and n.profile_id is not distinct from r.profile_id
     and n.contact_id is not distinct from r.contact_id
     and n.role <> 'responsible'
     and (r.role, r.notify_email, r.notify_whatsapp)
         is distinct from (n.role, coalesce(n.notify_email, true), coalesce(n.notify_whatsapp, false));

  update public.activity_recipients r
     set role = n.role,
         notify_email = coalesce(n.notify_email, true),
         notify_whatsapp = coalesce(n.notify_whatsapp, false)
    from jsonb_to_recordset(p_recipients)
           as n(profile_id uuid, contact_id uuid, role public.recipient_role, notify_email boolean, notify_whatsapp boolean)
   where r.activity_id = p_activity_id
     and n.profile_id is not distinct from r.profile_id
     and n.contact_id is not distinct from r.contact_id
     and n.role = 'responsible'
     and (r.role, r.notify_email, r.notify_whatsapp)
         is distinct from (n.role, coalesce(n.notify_email, true), coalesce(n.notify_whatsapp, false));

  -- 4. Add new people.
  insert into public.activity_recipients (activity_id, profile_id, contact_id, role, notify_email, notify_whatsapp)
  select p_activity_id, n.profile_id, n.contact_id, n.role,
         coalesce(n.notify_email, true), coalesce(n.notify_whatsapp, false)
    from jsonb_to_recordset(p_recipients)
           as n(profile_id uuid, contact_id uuid, role public.recipient_role, notify_email boolean, notify_whatsapp boolean)
   where not exists (select 1 from public.activity_recipients r
                      where r.activity_id = p_activity_id
                        and r.profile_id is not distinct from n.profile_id
                        and r.contact_id is not distinct from n.contact_id);
end;
$$;

-- Create (no "id" in p_activity) or edit an activity and its people, all or nothing.
-- p_activity holds the form fields; status and bookkeeping columns in it are ignored.
-- Editing requires p_expected_version: the version the person started from.
-- Returns the activity id. SECURITY INVOKER, so RLS applies to the activity row.
create function public.save_activity(p_activity jsonb, p_recipients jsonb, p_expected_version integer default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a         public.activities;
  v_id      uuid;
  v_version integer;
begin
  if jsonb_typeof(p_activity) is distinct from 'object' then
    raise exception 'Activity details must be given as a JSON object' using errcode = '22023';
  end if;

  a := jsonb_populate_record(null::public.activities, p_activity);
  v_id := a.id;

  if v_id is null then
    insert into public.activities (
      title, description, timezone, activity_date, start_time, end_time, location, meeting_url,
      contact_name, contact_phone, contact_email, preparation_notes, visibility,
      reminders_enabled, include_in_weekly_summary)
    values (
      a.title, a.description,
      coalesce(a.timezone, (select o.timezone from public.office_info() o), 'Africa/Lagos'),
      a.activity_date, a.start_time, a.end_time, a.location, a.meeting_url,
      a.contact_name, a.contact_phone, a.contact_email, a.preparation_notes,
      coalesce(a.visibility, 'office'),
      coalesce(a.reminders_enabled, true), coalesce(a.include_in_weekly_summary, true))
    returning id into v_id;
  else
    if p_expected_version is null then
      raise exception 'The version being edited is required' using errcode = '22023';
    end if;

    update public.activities
       set title = a.title,
           description = a.description,
           timezone = coalesce(a.timezone, timezone),
           activity_date = a.activity_date,
           start_time = a.start_time,
           end_time = a.end_time,
           location = a.location,
           meeting_url = a.meeting_url,
           contact_name = a.contact_name,
           contact_phone = a.contact_phone,
           contact_email = a.contact_email,
           preparation_notes = a.preparation_notes,
           visibility = coalesce(a.visibility, visibility),
           reminders_enabled = coalesce(a.reminders_enabled, reminders_enabled),
           include_in_weekly_summary = coalesce(a.include_in_weekly_summary, include_in_weekly_summary)
     where id = v_id
       and version = p_expected_version;

    if not found then
      select version into v_version from public.activities where id = v_id;
      if v_version is not null and v_version <> p_expected_version then
        raise exception 'This activity was changed by someone else while you were editing it'
          using errcode = '40001';
      end if;
      raise exception 'Activity not found, or you do not have permission to edit it' using errcode = '42501';
    end if;
  end if;

  perform public.set_activity_recipients(v_id, p_recipients);
  return v_id;
end;
$$;

-- Complete, cancel or reopen an activity. Allowed changes: scheduled -> completed | cancelled,
-- and completed | cancelled -> scheduled. Cancelling needs a reason; reopening clears it.
-- Returns the new version.
create function public.set_activity_status(
  p_activity_id uuid,
  p_status public.activity_status,
  p_reason text default null,
  p_expected_version integer default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current     public.activity_status;
  v_version     integer;
  v_new_version integer;
  v_reason      text := nullif(btrim(p_reason), '');
begin
  select status, version into v_current, v_version from public.activities where id = p_activity_id;
  if not found then
    raise exception 'Activity not found, or you do not have permission to edit it' using errcode = '42501';
  end if;
  if p_expected_version is not null and v_version <> p_expected_version then
    raise exception 'This activity was changed by someone else while you were editing it' using errcode = '40001';
  end if;
  if v_current = p_status then
    raise exception 'The activity is already %', p_status using errcode = '22023';
  end if;
  if v_current <> 'scheduled' and p_status <> 'scheduled' then
    raise exception 'Reopen the activity before changing it to %', p_status using errcode = '22023';
  end if;
  if p_status = 'cancelled' and v_reason is null then
    raise exception 'Give a reason for cancelling the activity' using errcode = '22023';
  end if;

  update public.activities
     set status = p_status,
         status_reason = case when p_status = 'scheduled' then null else v_reason end
   where id = p_activity_id
     and version = v_version
  returning version into v_new_version;

  if not found then
    if exists (select 1 from public.activities where id = p_activity_id and version <> v_version) then
      raise exception 'This activity was changed by someone else while you were editing it' using errcode = '40001';
    end if;
    raise exception 'Activity not found, or you do not have permission to edit it' using errcode = '42501';
  end if;

  return v_new_version;
end;
$$;

revoke execute on function public.office_info(),
                           public.set_activity_recipients(uuid, jsonb),
                           public.save_activity(jsonb, jsonb, integer),
                           public.set_activity_status(uuid, public.activity_status, text, integer)
  from public, anon;
grant execute on function public.office_info(),
                          public.set_activity_recipients(uuid, jsonb),
                          public.save_activity(jsonb, jsonb, integer),
                          public.set_activity_status(uuid, public.activity_status, text, integer)
  to authenticated;
