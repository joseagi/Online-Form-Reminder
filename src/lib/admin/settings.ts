import { z } from 'zod';
import { addDays } from '@/lib/activities/filters';

// Admin settings form (a subset of public.system_settings), validated in the browser and again
// in the Server Action. The database constraints remain the final authority.

const optionalEmail = z
  .string()
  .trim()
  .max(254, 'Use at most 254 characters.')
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address.');

export const NOTIFICATION_MODES = ['off', 'test', 'live'] as const;

export const settingsSchema = z.object({
  officeName: z.string().trim().min(1, 'Enter the office name.').max(120, 'Use at most 120 characters.'),
  summaryEnabled: z.boolean(),
  summarySendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a send time.'),
  summarySendIfEmpty: z.boolean(),
  summaryLateCutoffHours: z.number().int('Use whole hours.').min(0, 'Use 0 to 24 hours.').max(24, 'Use 0 to 24 hours.'),
  notificationMode: z.enum(NOTIFICATION_MODES),
  testRedirectEmail: optionalEmail,
  emailFromName: z
    .string()
    .trim()
    .min(1, 'Enter a sender name.')
    .max(80, 'Use at most 80 characters.')
    .refine((v) => !/[\u0000-\u001F\u007F<>"]/.test(v), 'The sender name cannot contain line breaks, <, > or quotes.'),
  emailReplyTo: optionalEmail,
});

export type SettingsForm = z.input<typeof settingsSchema>;

export type SettingsRow = {
  office_name: string;
  timezone: string;
  weekly_summary_enabled: boolean;
  weekly_summary_send_time: string;
  weekly_summary_send_if_empty: boolean;
  weekly_summary_late_cutoff: string;
  notification_mode: 'off' | 'test' | 'live';
  test_redirect_email: string | null;
  email_from_name: string;
  email_reply_to: string | null;
};

// Postgres intervals arrive as text, e.g. "16:00:00" or "1 day". Whole hours only.
export function intervalHours(value: string): number {
  const days = /(\d+) days?/.exec(value)?.[1];
  const hours = /(\d+):\d{2}:\d{2}/.exec(value)?.[1];
  return Number(days ?? 0) * 24 + Number(hours ?? 0);
}

export function toSettingsForm(row: SettingsRow): SettingsForm {
  return {
    officeName: row.office_name,
    summaryEnabled: row.weekly_summary_enabled,
    summarySendTime: row.weekly_summary_send_time.slice(0, 5),
    summarySendIfEmpty: row.weekly_summary_send_if_empty,
    summaryLateCutoffHours: intervalHours(row.weekly_summary_late_cutoff),
    notificationMode: row.notification_mode,
    testRedirectEmail: row.test_redirect_email ?? '',
    emailFromName: row.email_from_name,
    emailReplyTo: row.email_reply_to ?? '',
  };
}

export function toSettingsUpdate(values: z.output<typeof settingsSchema>) {
  return {
    office_name: values.officeName,
    weekly_summary_enabled: values.summaryEnabled,
    weekly_summary_send_time: values.summarySendTime,
    weekly_summary_send_if_empty: values.summarySendIfEmpty,
    weekly_summary_late_cutoff: `${values.summaryLateCutoffHours} hours`,
    notification_mode: values.notificationMode,
    test_redirect_email: values.testRedirectEmail || null,
    email_from_name: values.emailFromName,
    email_reply_to: values.emailReplyTo || null,
  };
}

// When the next Sunday summary goes out and which week (Monday) it covers, as of `now` in the
// office time zone. On a Sunday after the send time, that's next Sunday's.
export function nextSummary(input: { now: Date; timeZone: string; sendTime: string }): { sendDate: string; periodStart: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: input.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(input.now)
      .map((p) => [p.type, p.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const isoDow = new Date(`${today}T00:00:00Z`).getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  let sunday = addDays(today, 7 - isoDow);
  if (isoDow === 7 && `${parts.hour}:${parts.minute}` >= input.sendTime.slice(0, 5)) sunday = addDays(sunday, 7);
  return { sendDate: sunday, periodStart: addDays(sunday, 1) };
}

// Plain-language reasons for the notification log.
export const STATUS_REASON_LABELS: Record<string, string> = {
  expired: 'Too late: past the deadline, so not sent',
  outcome_unknown: 'Unclear whether it was sent: check with the email provider before resending',
  empty_week: 'Nothing scheduled that week',
  notifications_off: 'Notifications were switched off',
  unsubscribed: 'The person no longer receives the summary',
  summary_disabled: 'The weekly summary was switched off',
  retrying: 'Temporary problem: waiting to try again',
  retries_exhausted: 'Gave up after repeated temporary problems',
  rejected: 'Refused by the email provider',
  unsupported_kind: 'This kind of message is not supported yet',
  // Reminders
  rescheduled: 'The activity moved to a different time (a new reminder was planned)',
  activity_cancelled: 'The activity was cancelled',
  activity_completed: 'The activity was marked as completed',
  activity_missing: 'The activity no longer exists',
  reminders_off: 'Reminders were turned off for the activity',
  recipient_removed: 'The person was removed from the activity, or turned off email reminders',
  recipient_inactive: 'The person is no longer active, or has no email address',
};
