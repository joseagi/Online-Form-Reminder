import { ROLE_LABELS, type RecipientRole } from '@/lib/activities/schema';

// Turns raw audit entries (public.activity_history) into short, plain-language sentences.

export type HistoryEntry = {
  id: number;
  occurred_at: string;
  actor_name: string;
  entity: string;
  operation: string;
  person_name: string | null;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  timezone: 'time zone',
  activity_date: 'date',
  start_time: 'start time',
  end_time: 'end time',
  location: 'location',
  meeting_url: 'meeting link',
  contact_name: 'contact name',
  contact_phone: 'contact phone',
  contact_email: 'contact email',
  preparation_notes: 'preparation notes',
  visibility: 'visibility',
  reminders_enabled: 'reminder setting',
  include_in_weekly_summary: 'Sunday summary setting',
};

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function roleLabel(value: unknown): string {
  return (ROLE_LABELS[value as RecipientRole] ?? String(value)).toLowerCase();
}

// What the actor did, without the actor's name, e.g. "changed the date and start time".
// Returns null for entries with nothing worth showing.
export function describeChange(entry: HistoryEntry): string | null {
  const fields = entry.changed_fields ?? [];
  const before = entry.old_data ?? {};
  const after = entry.new_data ?? {};

  if (entry.entity === 'person') {
    const name = entry.person_name ?? 'someone';
    if (entry.operation === 'insert') return `added ${name} as ${roleLabel(after.role)}`;
    if (entry.operation === 'delete') return `removed ${name}`;
    const parts: string[] = [];
    if (fields.includes('role')) parts.push(`made ${name} ${roleLabel(after.role)}`);
    if (fields.includes('notify_email')) {
      parts.push(`turned email reminders ${after.notify_email ? 'on' : 'off'} for ${name}`);
    }
    return parts.length ? parts.join('; ') : null;
  }

  if (entry.operation === 'insert') return 'created the activity';
  if (entry.operation === 'delete') return 'deleted the activity';

  const parts: string[] = [];
  if (fields.includes('status')) {
    const reason = typeof after.status_reason === 'string' && after.status_reason ? `: ${after.status_reason}` : '';
    if (after.status === 'cancelled') parts.push(`cancelled the activity${reason}`);
    else if (after.status === 'completed') parts.push(`marked it completed${reason}`);
    else if (after.status === 'scheduled') parts.push(`reopened it (it was ${before.status})`);
  }

  // Derived and bookkeeping columns are implied by the fields people actually edit.
  const edited = fields.map((f) => FIELD_LABELS[f]).filter((label): label is string => Boolean(label));
  if (edited.length) parts.push(`changed the ${list(edited)}`);

  return parts.length ? parts.join('; ') : null;
}
