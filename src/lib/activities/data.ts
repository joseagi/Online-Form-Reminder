import 'server-only';
import type { ActivityFormValues, PersonEntry } from '@/lib/activities/schema';
import { PAGE_SIZE, type ActivityFilters } from '@/lib/activities/filters';
import { formatTime } from '@/lib/activities/format';
import type { HistoryEntry } from '@/lib/activities/history';
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

// The register: activities the user may see, filtered and paged. `person_filter` is an inner
// join used only for filtering by person (every activity has at least its responsible person).
const LIST_COLUMNS = `
  id, title, activity_date, start_time, end_time, location, status, visibility,
  people:activity_recipients(role, profile:profiles(full_name)),
  person_filter:activity_recipients!inner(profile_id)`;

export type ActivityListItem = {
  id: string;
  title: string;
  activityDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  restricted: boolean;
  responsible: string | null;
};

export async function listActivities(
  filters: ActivityFilters,
  currentUserId: string,
  pageSize = PAGE_SIZE,
): Promise<{ rows: ActivityListItem[]; total: number; pageOutOfRange: boolean }> {
  const supabase = await createClient();
  let query = supabase.from('activities').select(LIST_COLUMNS, { count: 'exact' });

  if (filters.q) query = query.textSearch('search', filters.q, { type: 'websearch', config: 'english' });
  if (filters.from) query = query.gte('activity_date', filters.from);
  if (filters.to) query = query.lte('activity_date', filters.to);
  if (filters.status !== 'all') query = query.eq('status', filters.status);
  const person = filters.person === 'me' ? currentUserId : filters.person;
  if (person) query = query.eq('person_filter.profile_id', person);

  const offset = (filters.page - 1) * pageSize;
  const { data, error, count } = await query
    .order('starts_at', { ascending: filters.order === 'asc' })
    .order('id')
    .range(offset, offset + pageSize - 1);

  // PGRST103: the requested page is past the last result.
  if (error?.code === 'PGRST103') return { rows: [], total: 0, pageOutOfRange: true };
  if (error) throw new Error(`Could not load activities: ${error.message}`);

  return {
    rows: data.map((a) => ({
      id: a.id,
      title: a.title,
      activityDate: a.activity_date,
      startTime: a.start_time,
      endTime: a.end_time,
      location: a.location,
      status: a.status,
      restricted: a.visibility === 'restricted',
      responsible: a.people.find((p) => p.role === 'responsible')?.profile?.full_name ?? null,
    })),
    total: count ?? 0,
    pageOutOfRange: false,
  };
}

// What happened to the activity, oldest first (empty if the user may not see it).
export async function getActivityHistory(id: string): Promise<HistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('activity_history', { p_activity_id: id });
  if (error) throw new Error(`Could not load the history: ${error.message}`);
  return data.map((row) => ({
    ...row,
    old_data: row.old_data as Record<string, unknown> | null,
    new_data: row.new_data as Record<string, unknown> | null,
  }));
}

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
