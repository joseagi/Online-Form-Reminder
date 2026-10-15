-- Core tables: staff profiles, external contacts, activities, recipients, settings.
-- RLS is enabled on every table here with no policies yet, so the API roles are denied by
-- default. Access policies are added in the next stage (2c).

-- profiles: staff logins, 1:1 with auth.users ---------------------------------------
-- No ON DELETE CASCADE: staff are deactivated (is_active = false), never deleted, because
-- activities and audit history reference them.
create table public.profiles (
  id                      uuid primary key references auth.users (id),
  full_name               text not null check (char_length(btrim(full_name)) between 1 and 120),
  email                   public.email_address not null unique,
  phone                   public.phone_e164,
  role                    public.app_role not null default 'staff',
  is_active               boolean not null default true,
  receives_weekly_summary boolean not null default true,
  whatsapp_opt_in_at      timestamptz,   -- Phase 8: consent evidence
  whatsapp_opt_out_at     timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.profiles is
  'Staff logins (1:1 with auth.users). Deactivate, never delete: history references these rows.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- contacts: external people without a login -----------------------------------------
create table public.contacts (
  id                      uuid primary key default gen_random_uuid(),
  full_name               text not null check (char_length(btrim(full_name)) between 1 and 120),
  organisation            text check (char_length(organisation) <= 200),
  email                   public.email_address,
  phone                   public.phone_e164,
  receives_weekly_summary boolean not null default false,   -- e.g. a shared group mailbox
  whatsapp_opt_in_at      timestamptz,
  whatsapp_opt_out_at     timestamptz,
  is_active               boolean not null default true,
  created_by              uuid not null default auth.uid() references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint contacts_has_channel check (email is not null or phone is not null),
  constraint contacts_summary_needs_email check (not receives_weekly_summary or email is not null)
);
create unique index contacts_email_key on public.contacts (email) where email is not null;
create index contacts_created_by_idx on public.contacts (created_by);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- activities -------------------------------------------------------------------------
-- The wall-clock fields (activity_date, start_time, end_time, timezone) are what the user
-- entered and are the source of truth. starts_at / ends_at are derived by a trigger and are
-- what all scheduling queries use.
create table public.activities (
  id                        uuid primary key default gen_random_uuid(),
  title                     text not null check (char_length(btrim(title)) between 1 and 200),
  description               text check (char_length(description) <= 5000),
  timezone                  text not null default 'Africa/Lagos',
  activity_date             date not null,
  start_time                time,          -- null => date-only activity
  end_time                  time,
  starts_at                 timestamptz not null,
  ends_at                   timestamptz,
  location                  text check (char_length(location) <= 300),
  meeting_url               text check (meeting_url ~* '^https?://\S+$' and char_length(meeting_url) <= 2000),
  contact_name              text check (char_length(contact_name) <= 120),
  contact_phone             text check (char_length(contact_phone) <= 40),
  contact_email             public.email_address,
  preparation_notes         text check (char_length(preparation_notes) <= 5000),
  status                    public.activity_status not null default 'scheduled',
  visibility                public.activity_visibility not null default 'office',
  reminders_enabled         boolean not null default true,
  include_in_weekly_summary boolean not null default true,
  status_reason             text check (char_length(status_reason) <= 500),
  status_changed_at         timestamptz,
  status_changed_by         uuid references public.profiles (id),
  version                   integer not null default 1,
  created_by                uuid not null default auth.uid() references public.profiles (id),
  updated_by                uuid references public.profiles (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  search                    tsvector generated always as (
                              setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                              setweight(to_tsvector('english', coalesce(description, '') || ' ' ||
                                coalesce(location, '') || ' ' || coalesce(preparation_notes, '')), 'B')
                            ) stored,
  constraint activities_time_order
    check (end_time is null or (start_time is not null and end_time > start_time))
);
create index activities_starts_at_idx    on public.activities (starts_at);
create index activities_status_start_idx on public.activities (status, starts_at);
create index activities_search_idx       on public.activities using gin (search);
create index activities_created_by_idx   on public.activities (created_by);

create function public.activities_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;

  -- Derive instants from the wall-clock intent. Client-supplied values are always overwritten.
  new.starts_at := (new.activity_date + coalesce(new.start_time, time '00:00')) at time zone new.timezone;
  new.ends_at := case
    when new.end_time is not null then (new.activity_date + new.end_time) at time zone new.timezone
    when new.start_time is null   then (new.activity_date + 1 + time '00:00') at time zone new.timezone
  end;

  if tg_op = 'INSERT' then
    new.version           := 1;
    new.updated_by        := null;
    new.status_changed_at := null;
    new.status_changed_by := null;
  else
    new.version    := old.version + 1;
    new.updated_at := now();
    new.updated_by := auth.uid();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.status_changed_at := now();
      new.status_changed_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

create trigger activities_before_write
  before insert or update on public.activities
  for each row execute function public.activities_before_write();

-- activity_recipients: who is involved and who is notified ---------------------------
create table public.activity_recipients (
  id              uuid primary key default gen_random_uuid(),
  activity_id     uuid not null references public.activities (id) on delete cascade,
  profile_id      uuid references public.profiles (id),
  contact_id      uuid references public.contacts (id),
  role            public.recipient_role not null,
  notify_email    boolean not null default true,
  notify_whatsapp boolean not null default false,   -- Phase 8
  created_at      timestamptz not null default now(),
  constraint activity_recipients_one_person   check (num_nonnulls(profile_id, contact_id) = 1),
  constraint activity_recipients_responsible_is_staff check (role <> 'responsible' or profile_id is not null),
  constraint activity_recipients_profile_key  unique (activity_id, profile_id),
  constraint activity_recipients_contact_key  unique (activity_id, contact_id)
);
create unique index activity_recipients_one_responsible
  on public.activity_recipients (activity_id) where role = 'responsible';
create index activity_recipients_profile_idx on public.activity_recipients (profile_id);
create index activity_recipients_contact_idx on public.activity_recipients (contact_id);

-- system_settings: exactly one row of typed, validated settings ----------------------
create table public.system_settings (
  id                           boolean primary key default true
                                 constraint system_settings_singleton check (id),
  office_name                  text not null default 'Office'
                                 check (char_length(btrim(office_name)) between 1 and 120),
  timezone                     text not null default 'Africa/Lagos',
  notification_mode            public.notification_mode not null default 'test',
  test_redirect_email          public.email_address,
  email_from_name              text not null default 'Office Reminders'
                                 check (char_length(btrim(email_from_name)) between 1 and 80
                                        and email_from_name !~ '[[:cntrl:]<>"]'),
  email_reply_to               public.email_address,
  weekly_summary_enabled       boolean not null default true,
  weekly_summary_send_time     time not null default '17:00',
  weekly_summary_send_if_empty boolean not null default false,
  weekly_summary_late_cutoff   interval not null default '16 hours'
                                 check (weekly_summary_late_cutoff between interval '0' and interval '24 hours'),
  reminder_lead                interval not null default '24 hours'
                                 check (reminder_lead between interval '1 hour' and interval '7 days'),
  date_only_reminder_time      time not null default '09:00',
  reminder_min_notice          interval not null default '2 hours'
                                 check (reminder_min_notice between interval '0' and interval '24 hours'),
  dispatch_batch_size          integer not null default 25 check (dispatch_batch_size between 1 and 100),
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.profiles (id)
);

create function public.system_settings_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger system_settings_before_update
  before update on public.system_settings
  for each row execute function public.system_settings_before_update();

insert into public.system_settings default values;

-- Security: RLS on, no anonymous access, trigger functions not callable via the API ---
alter table public.profiles            enable row level security;
alter table public.contacts            enable row level security;
alter table public.activities          enable row level security;
alter table public.activity_recipients enable row level security;
alter table public.system_settings     enable row level security;

revoke all on public.profiles, public.contacts, public.activities,
              public.activity_recipients, public.system_settings
  from anon;

-- The settings row is never inserted or deleted through the API.
revoke insert, delete, truncate on public.system_settings from authenticated, service_role;

revoke execute on function public.activities_before_write()       from public, anon, authenticated;
revoke execute on function public.system_settings_before_update() from public, anon, authenticated;
