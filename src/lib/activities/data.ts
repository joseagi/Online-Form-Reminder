import 'server-only';
import type { ActivityFormValues, PersonEntry } from '@/lib/activities/schema';
import { formatTime } from '@/lib/activities/format';
import type { ContactOption, StaffOption } from '@/lib/activities/types';
import { createClient } from '@/lib/supabase/server';

// All reads use the signed-in user's session, so RLS decides what is visible.

export async function getPeopleOptions(): Promise<{ staff: StaffOption[]; contacts: ContactOption[] }> {
  const supabase = await createClient();
  const [staff, contacts] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email').eq('is_active', true).order('full_name'),
    supabase.from('contacts').select('id, full_name, organisation, email, phone').eq('is_active', true).order('full_name'),
  ]);
  if (staff.error) throw new Error(`Could not load staff: ${staff.error.message}`);
  if (contacts.error) throw new Error(`Could not load contacts: ${contacts.error.message}`);

  return {
    staff: staff.data.map((p) => ({ id: p.id, fullName: p.full_name, email: p.email })),
    contacts: contacts.data.map((c) => ({
      id: c.id, fullName: c.full_name, organisation: c.organisation, email: c.email, phone: c.phone,
    })),
  };
}

export async function getOfficeInfo(): Promise<{ officeName: string; timezone: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('office_info');
  if (error) throw new Error(`Could not load office settings: ${error.message}`);
  const row = data?.[0];
  return { officeName: row?.office_name ?? 'Office', timezone: row?.timezone ?? 'Africa/Lagos' };
}

const ACTIVITY_COLUMNS = `
  id, title, description, timezone, activity_date, start_time, end_time, starts_at, location, meeting_url,
  contact_name, contact_phone, contact_email, preparation_notes, status, status_reason, visibility,
  reminders_enabled, include_in_weekly_summary, version, created_by, created_at, updated_at,
  creator:profiles!activities_created_by_fkey(full_name),
  people:activity_recipients(
    id, role, notify_email, profile_id, contact_id,
    profile:profiles(full_name, email, is_active),
    contact:contacts(full_name, email, phone, organisation, is_active)
  )`;

const ROLE_ORDER = { responsible: 0, collaborator: 1, notify_only: 2 } as const;

// One activity with its people, or null if it doesn't exist or the user may not see it.
export async function getActivity(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('activities').select(ACTIVITY_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load the activity: ${error.message}`);
  if (!data) return null;

  const people = [...data.people].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      (a.profile?.full_name ?? a.contact?.full_name ?? '').localeCompare(b.profile?.full_name ?? b.contact?.full_name ?? ''),
  );
  return { ...data, people };
}

export type Activity = NonNullable<Awaited<ReturnType<typeof getActivity>>>;

export async function canEditActivity(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('can_edit_activity', { p_activity_id: id });
  if (error) throw new Error(`Could not check permissions: ${error.message}`);
  return data === true;
}

export function toFormValues(activity: Activity): ActivityFormValues {
  const people: PersonEntry[] = activity.people.map((p) =>
    p.profile_id
      ? { kind: 'staff', profileId: p.profile_id, name: p.profile?.full_name ?? 'Former staff member', role: p.role,
          notifyEmail: p.notify_email }
      : { kind: 'contact', contactId: p.contact_id!, name: p.contact?.full_name ?? 'Unknown contact',
          hasEmail: Boolean(p.contact?.email), role: p.role === 'responsible' ? 'collaborator' : p.role,
          notifyEmail: p.notify_email },
  );

  return {
    id: activity.id,
    expectedVersion: activity.version,
    title: activity.title,
    description: activity.description ?? '',
    activityDate: activity.activity_date,
    allDay: activity.start_time === null,
    startTime: formatTime(activity.start_time),
    endTime: formatTime(activity.end_time),
    location: activity.location ?? '',
    meetingUrl: activity.meeting_url ?? '',
    contactName: activity.contact_name ?? '',
    contactPhone: activity.contact_phone ?? '',
    contactEmail: activity.contact_email ?? '',
    preparationNotes: activity.preparation_notes ?? '',
    visibility: activity.visibility,
    remindersEnabled: activity.reminders_enabled,
    includeInWeeklySummary: activity.include_in_weekly_summary,
    people,
  };
}
