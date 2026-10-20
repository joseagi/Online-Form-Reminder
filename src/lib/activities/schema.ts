import { z } from 'zod';

// The activity form, validated identically in the browser and in the Server Action. The rules
// mirror the database (supabase/migrations), which remains the final authority.

export const RECIPIENT_ROLES = ['responsible', 'collaborator', 'notify_only'] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];
export const ROLE_LABELS: Record<RecipientRole, string> = {
  responsible: 'Responsible',
  collaborator: 'Collaborator',
  notify_only: 'Notify only',
};

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_E164 = /^\+[1-9][0-9]{7,14}$/;

export function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

// "+234 803-123 4567" -> "+2348031234567"
export function normalizePhone(value: string): string {
  return value.replace(/[\s\-().]/g, '');
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const text = (max: number, what: string) => z.string().trim().max(max, `${what} must be at most ${max} characters.`);

const optionalEmail = z
  .string()
  .trim()
  .max(254, 'Use at most 254 characters.')
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address.');

const staffPerson = z.object({
  kind: z.literal('staff'),
  profileId: z.uuid(),
  name: z.string(),
  role: z.enum(RECIPIENT_ROLES),
  notifyEmail: z.boolean(),
});

const contactPerson = z.object({
  kind: z.literal('contact'),
  contactId: z.uuid(),
  name: z.string(),
  hasEmail: z.boolean(),
  role: z.enum(['collaborator', 'notify_only']),
  notifyEmail: z.boolean(),
});

export const newContactPerson = z
  .object({
    kind: z.literal('new-contact'),
    key: z.string(),
    name: z.string().trim().min(1, 'Enter the person’s name.').max(120, 'Use at most 120 characters for the name.'),
    email: optionalEmail,
    phone: z
      .string()
      .trim()
      .refine(
        (v) => v === '' || PHONE_E164.test(normalizePhone(v)),
        'Enter the phone number in international format, e.g. +2348031234567.',
      ),
    organisation: text(200, 'The organisation'),
    role: z.enum(['collaborator', 'notify_only']),
    notifyEmail: z.boolean(),
  })
  .refine((p) => p.email !== '' || p.phone !== '', { message: 'Give an email address or a phone number.', path: ['email'] })
  .refine((p) => !p.notifyEmail || p.email !== '', { message: 'Email reminders need an email address.', path: ['notifyEmail'] });

export const personSchema = z.discriminatedUnion('kind', [staffPerson, contactPerson, newContactPerson]);
export type PersonEntry = z.input<typeof personSchema>;

export function personKey(person: PersonEntry): string {
  if (person.kind === 'staff') return `staff:${person.profileId}`;
  if (person.kind === 'contact') return `contact:${person.contactId}`;
  return person.email ? `email:${person.email.trim().toLowerCase()}` : `new:${person.key}`;
}

export const activityFormSchema = z
  .object({
    id: z.uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    title: z.string().trim().min(1, 'Enter a title.').max(200, 'Use at most 200 characters for the title.'),
    description: text(5000, 'The description'),
    activityDate: z.string().refine(isRealDate, 'Choose a date.'),
    allDay: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    location: text(300, 'The location'),
    meetingUrl: z
      .string()
      .trim()
      .max(2000, 'The link is too long.')
      .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Enter a full link starting with https://'),
    contactName: text(120, 'The contact name'),
    contactPhone: text(40, 'The contact phone'),
    contactEmail: optionalEmail,
    preparationNotes: text(5000, 'The preparation notes'),
    visibility: z.enum(['office', 'restricted']),
    remindersEnabled: z.boolean(),
    includeInWeeklySummary: z.boolean(),
    people: z.array(personSchema).max(100, 'Too many people.'),
  })
  .superRefine((v, ctx) => {
    if (!v.allDay) {
      if (!TIME_OF_DAY.test(v.startTime)) {
        ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Choose a start time, or tick “All day”.' });
      } else if (v.endTime !== '' && (!TIME_OF_DAY.test(v.endTime) || v.endTime <= v.startTime)) {
        ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'The end time must be after the start time.' });
      }
    }

    if (v.people.filter((p) => p.role === 'responsible').length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['people'], message: 'Choose exactly one responsible person.' });
    }

    const seen = new Set<string>();
    for (const person of v.people) {
      const key = personKey(person);
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['people'], message: `${person.name || 'Someone'} is listed twice.` });
      }
      seen.add(key);
    }

    if (v.id && v.expectedVersion === undefined) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'Reload the page and try again.' });
    }
  });

export type ActivityFormValues = z.input<typeof activityFormSchema>;
export type ValidActivityForm = z.output<typeof activityFormSchema>;

// Field path -> first message, e.g. { "endTime": "...", "people.2.email": "..." }.
export function issuesByPath(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'form';
    result[path] ??= issue.message;
  }
  return result;
}

export function emptyActivityForm(responsible: { profileId: string; name: string }): ActivityFormValues {
  return {
    title: '',
    description: '',
    activityDate: '',
    allDay: false,
    startTime: '',
    endTime: '',
    location: '',
    meetingUrl: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    preparationNotes: '',
    visibility: 'office',
    remindersEnabled: true,
    includeInWeeklySummary: true,
    people: [{ kind: 'staff', profileId: responsible.profileId, name: responsible.name, role: 'responsible', notifyEmail: true }],
  };
}

const orNull = (value: string) => (value === '' ? null : value);

// The p_activity argument of public.save_activity.
export function toActivityPayload(v: ValidActivityForm) {
  return {
    ...(v.id ? { id: v.id } : {}),
    title: v.title,
    description: orNull(v.description),
    activity_date: v.activityDate,
    start_time: v.allDay ? null : v.startTime,
    end_time: v.allDay ? null : orNull(v.endTime),
    location: orNull(v.location),
    meeting_url: orNull(v.meetingUrl),
    contact_name: orNull(v.contactName),
    contact_phone: orNull(v.contactPhone),
    contact_email: orNull(v.contactEmail),
    preparation_notes: orNull(v.preparationNotes),
    visibility: v.visibility,
    reminders_enabled: v.remindersEnabled,
    include_in_weekly_summary: v.includeInWeeklySummary,
  };
}
