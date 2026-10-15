-- Foundation: extensions, shared value types, enums and generic trigger helpers.

create extension if not exists citext with schema extensions;

-- Shared value types ----------------------------------------------------------

-- Case-insensitive email with a basic shape check (full validation happens in the app with Zod).
create domain public.email_address as extensions.citext
  check (value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(value) <= 254);

-- International phone number in E.164 form, e.g. +2348031234567 (needed for WhatsApp in Phase 8).
create domain public.phone_e164 as text
  check (value ~ '^\+[1-9][0-9]{7,14}$');

-- Enums ---------------------------------------------------------------------------

create type public.app_role             as enum ('admin', 'staff');
create type public.activity_status      as enum ('scheduled', 'completed', 'cancelled');
create type public.activity_visibility  as enum ('office', 'restricted');
create type public.recipient_role       as enum ('responsible', 'collaborator', 'notify_only');
create type public.notification_channel as enum ('email', 'whatsapp');
create type public.notification_kind    as enum ('day_before_reminder', 'weekly_summary', 'test');
create type public.job_status           as enum ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped');
create type public.delivery_status      as enum ('unknown', 'delivered', 'delayed', 'bounced', 'complained', 'failed', 'suppressed');
create type public.notification_mode    as enum ('off', 'test', 'live');

-- Generic trigger helper ----------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Trigger functions are not API endpoints.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
