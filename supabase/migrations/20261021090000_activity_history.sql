-- Change history of one activity (its own row and its people), built from the audit trail.
-- Anyone who can see the activity can see its history; everyone else gets no rows.

create function public.activity_history(p_activity_id uuid)
returns table (
  id             bigint,
  occurred_at    timestamptz,
  actor_name     text,        -- 'System' when no signed-in user made the change
  entity         text,        -- 'activity' | 'person'
  operation      text,        -- 'insert' | 'update' | 'delete'
  person_name    text,        -- for entity = 'person'
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id,
         l.occurred_at,
         coalesce(actor.full_name, 'System'),
         case l.table_name when 'activities' then 'activity' else 'person' end,
         split_part(l.action, '.', 2),
         case when l.table_name = 'activity_recipients' then coalesce(p.full_name, c.full_name) end,
         l.changed_fields,
         l.old_data,
         l.new_data
    from public.audit_logs l
    left join public.profiles actor on actor.id = l.actor_id
    left join public.profiles p on p.id = (coalesce(l.new_data, l.old_data) ->> 'profile_id')::uuid
    left join public.contacts c on c.id = (coalesce(l.new_data, l.old_data) ->> 'contact_id')::uuid
   where public.can_view_activity(p_activity_id)
     and (   (l.table_name = 'activities' and l.record_id = p_activity_id::text)
          or (l.table_name = 'activity_recipients'
              and coalesce(l.new_data, l.old_data) ->> 'activity_id' = p_activity_id::text))
   order by l.occurred_at, l.id;
$$;

-- Finds an activity's people-related audit rows without scanning the whole log.
create index audit_logs_recipient_activity_idx
  on public.audit_logs ((coalesce(new_data, old_data) ->> 'activity_id'))
  where table_name = 'activity_recipients';

revoke execute on function public.activity_history(uuid) from public, anon;
grant execute on function public.activity_history(uuid) to authenticated;
