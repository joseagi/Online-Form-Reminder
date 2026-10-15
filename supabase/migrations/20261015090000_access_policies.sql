-- Access rules (RLS policies), the helper functions they use, and guards for columns that
-- only an administrator or the system may change.
--
--   Active staff   read the staff directory and contacts; see 'office' activities, plus
--                  'restricted' ones they created or are listed on; create activities as themselves.
--   Editors        (creator or responsible person) edit an activity and manage its people.
--   Admins         see and edit everything; manage settings, roles and access; read the logs.
--   Anyone else    (deactivated, or a valid login without a staff profile) sees nothing.
--   Nobody         deletes activities through the API: they are cancelled instead.

-- Helper functions ------------------------------------------------------------------
-- SECURITY DEFINER so policies can consult other tables without recursing through their
-- policies. Each answers only about the calling user, so they are safe to expose.

create function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'admin');
$$;

create function public.is_activity_recipient(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.activity_recipients
                  where activity_id = p_activity_id and profile_id = auth.uid());
$$;

create function public.is_activity_responsible(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.activity_recipients
                  where activity_id = p_activity_id and profile_id = auth.uid() and role = 'responsible');
$$;

create function public.can_view_activity(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_staff()
          and exists (select 1 from public.activities a
                       where a.id = p_activity_id
                         and (a.visibility = 'office'
                              or a.created_by = auth.uid()
                              or public.is_activity_recipient(a.id))));
$$;

create function public.can_edit_activity(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
      or (public.is_active_staff()
          and exists (select 1 from public.activities a
                       where a.id = p_activity_id
                         and (a.created_by = auth.uid() or public.is_activity_responsible(a.id))));
$$;

revoke execute on function public.is_active_staff(), public.is_admin(),
                           public.is_activity_recipient(uuid), public.is_activity_responsible(uuid),
                           public.can_view_activity(uuid), public.can_edit_activity(uuid)
  from public, anon;
grant execute on function public.is_active_staff(), public.is_admin(),
                          public.is_activity_recipient(uuid), public.is_activity_responsible(uuid),
                          public.can_view_activity(uuid), public.can_edit_activity(uuid)
  to authenticated;

-- Column guards -----------------------------------------------------------------------

-- Staff may edit their own name and phone. Role, access and notification settings are
-- admin-only; the email is copied from Auth and never edited here. The office must always
-- keep at least one active administrator.
create function public.profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public.profiles p
                      where p.role = 'admin' and p.is_active and p.id <> old.id) then
    raise exception 'At least one active administrator is required' using errcode = '23514';
  end if;

  -- No signed-in user: the Auth email sync, the service role, or the SQL console.
  if auth.uid() is null then
    return new;
  end if;

  if new.email is distinct from old.email then
    raise exception 'Email addresses are changed through sign-in settings, not the profile'
      using errcode = '42501';
  end if;

  if not public.is_admin()
     and (new.role                    is distinct from old.role
       or new.is_active               is distinct from old.is_active
       or new.receives_weekly_summary is distinct from old.receives_weekly_summary
       or new.whatsapp_opt_in_at      is distinct from old.whatsapp_opt_in_at
       or new.whatsapp_opt_out_at     is distinct from old.whatsapp_opt_out_at) then
    raise exception 'Only an administrator can change role, access or notification settings'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.profiles_guard_update();

-- Who created a contact never changes (ownership decides who may edit it).
create function public.contacts_keep_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger contacts_keep_creator
  before update on public.contacts
  for each row execute function public.contacts_keep_creator();

revoke execute on function public.profiles_guard_update() from public, anon, authenticated;
revoke execute on function public.contacts_keep_creator() from public, anon, authenticated;

-- Table privileges for signed-in users: exactly what the policies below can use --------
-- (No DELETE on activities: they are cancelled. No TRUNCATE anywhere: it bypasses RLS.)
revoke all on public.profiles, public.contacts, public.activities,
              public.activity_recipients, public.system_settings
  from authenticated;

grant select, update                 on public.profiles            to authenticated;
grant select, insert, update         on public.contacts            to authenticated;
grant select, insert, update         on public.activities          to authenticated;
grant select, insert, update, delete on public.activity_recipients to authenticated;
grant select, update                 on public.system_settings     to authenticated;

-- Policies ------------------------------------------------------------------------------
-- (select fn()) lets Postgres evaluate per-user checks once per statement, not once per row.

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated
  using ((select public.is_active_staff()));

create policy profiles_update on public.profiles
  for update to authenticated
  using      ((select public.is_admin()) or (id = (select auth.uid()) and (select public.is_active_staff())))
  with check ((select public.is_admin()) or (id = (select auth.uid()) and (select public.is_active_staff())));

-- contacts
create policy contacts_select on public.contacts
  for select to authenticated
  using ((select public.is_active_staff()));

create policy contacts_insert on public.contacts
  for insert to authenticated
  with check ((select public.is_active_staff()) and created_by = (select auth.uid()));

create policy contacts_update on public.contacts
  for update to authenticated
  using      ((select public.is_admin()) or ((select public.is_active_staff()) and created_by = (select auth.uid())))
  with check ((select public.is_admin()) or ((select public.is_active_staff()) and created_by = (select auth.uid())));

-- activities
-- Row columns are used directly (not can_view_activity(id)) so that INSERT ... RETURNING
-- works: a lookup by id cannot see a row inserted by the same statement.
create policy activities_select on public.activities
  for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_active_staff())
        and (visibility = 'office'
             or created_by = (select auth.uid())
             or public.is_activity_recipient(id)))
  );

create policy activities_insert on public.activities
  for insert to authenticated
  with check ((select public.is_active_staff()) and created_by = (select auth.uid()));

create policy activities_update on public.activities
  for update to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_active_staff())
        and (created_by = (select auth.uid()) or public.is_activity_responsible(id)))
  )
  with check (
    (select public.is_admin())
    or ((select public.is_active_staff())
        and (created_by = (select auth.uid()) or public.is_activity_responsible(id)))
  );

-- activity_recipients
create policy activity_recipients_select on public.activity_recipients
  for select to authenticated
  using (public.can_view_activity(activity_id));

create policy activity_recipients_insert on public.activity_recipients
  for insert to authenticated
  with check (public.can_edit_activity(activity_id));

create policy activity_recipients_update on public.activity_recipients
  for update to authenticated
  using      (public.can_edit_activity(activity_id))
  with check (public.can_edit_activity(activity_id));

create policy activity_recipients_delete on public.activity_recipients
  for delete to authenticated
  using (public.can_edit_activity(activity_id));

-- system_settings (admin only; the UI gets office name/time zone via a function in Phase 3)
create policy system_settings_select on public.system_settings
  for select to authenticated
  using ((select public.is_admin()));

create policy system_settings_update on public.system_settings
  for update to authenticated
  using      ((select public.is_admin()))
  with check ((select public.is_admin()));

-- notification_jobs: admins see all; editors see the reminders for their activities.
create policy notification_jobs_select on public.notification_jobs
  for select to authenticated
  using ((select public.is_admin()) or (activity_id is not null and public.can_edit_activity(activity_id)));

-- notification_logs and audit_logs: admins only.
create policy notification_logs_select on public.notification_logs
  for select to authenticated
  using ((select public.is_admin()));

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using ((select public.is_admin()));
