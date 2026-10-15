-- Append-only audit trail of changes to business tables.

create table public.audit_logs (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  -- auth.uid() at the time of the change; null = system (cron, dispatcher, auth service).
  -- Deliberately no foreign key: auditing must never block a write or a later clean-up.
  actor_id       uuid,
  action         text not null,     -- <table>.<insert|update|delete>, or semantic events added later
  table_name     text,
  record_id      text,
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[]
);
create index audit_logs_record_idx   on public.audit_logs (table_name, record_id, occurred_at desc);
create index audit_logs_actor_idx    on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);

create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Bookkeeping columns: the actor and timestamp are already recorded on the audit row.
  ignored constant text[] := array['updated_at', 'updated_by', 'version', 'search'];
  old_row jsonb;
  new_row jsonb;
  changed text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_row := to_jsonb(old) - ignored;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_row := to_jsonb(new) - ignored;
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into changed
      from jsonb_each(new_row) as n
     where n.value is distinct from old_row -> n.key;

    if changed is null then
      return null;   -- nothing meaningful changed
    end if;
  end if;

  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data, changed_fields)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name,
          coalesce(new_row, old_row) ->> 'id', old_row, new_row, changed);

  return null;
end;
$$;

create trigger audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();
create trigger audit_contacts
  after insert or update or delete on public.contacts
  for each row execute function public.audit_row_change();
create trigger audit_activities
  after insert or update or delete on public.activities
  for each row execute function public.audit_row_change();
create trigger audit_activity_recipients
  after insert or update or delete on public.activity_recipients
  for each row execute function public.audit_row_change();
create trigger audit_system_settings
  after insert or update or delete on public.system_settings
  for each row execute function public.audit_row_change();

alter table public.audit_logs enable row level security;

-- Append-only for every API role: only the SECURITY DEFINER trigger function writes here.
revoke all on public.audit_logs from anon, authenticated, service_role;
grant select on public.audit_logs to authenticated, service_role;

revoke execute on function public.audit_row_change() from public, anon, authenticated;
