import { describe, expect, it } from 'vitest';
import { intervalHours, nextSummary, settingsSchema, toSettingsForm, toSettingsUpdate, type SettingsForm } from './settings';

const valid: SettingsForm = {
  officeName: 'Lagos Office',
  summaryEnabled: true,
  summarySendTime: '17:00',
  summarySendIfEmpty: false,
  summaryLateCutoffHours: 16,
  notificationMode: 'test',
  testRedirectEmail: '',
  emailFromName: 'Office Reminders',
  emailReplyTo: '',
  reminderLeadHours: 24,
  dateOnlyReminderTime: '09:00',
  reminderMinNoticeHours: 2,
};

describe('settingsSchema', () => {
  it('accepts sensible settings', () => {
    expect(settingsSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['a missing send time', { summarySendTime: '' }, 'Choose a send time.'],
    ['a cutoff over a day', { summaryLateCutoffHours: 30 }, 'Use 0 to 24 hours.'],
    ['an invalid test address', { testRedirectEmail: 'qa@' }, 'Enter a valid email address.'],
    ['a sender name with a line break', { emailFromName: 'Office\nBcc: x@evil.example' }, 'The sender name cannot contain line breaks, <, > or quotes.'],
    ['an unknown mode', { notificationMode: 'loud' }, undefined],
    ['no reminder lead', { reminderLeadHours: 0 }, 'Use 1 to 168 hours.'],
    ['a reminder lead over a week', { reminderLeadHours: 169 }, 'Use 1 to 168 hours.'],
    ['part hours of notice', { reminderMinNoticeHours: 1.5 }, 'Use whole hours.'],
    ['a missing all-day reminder time', { dateOnlyReminderTime: '9' }, 'Choose a time.'],
  ])('rejects %s', (_label, overrides, message) => {
    const result = settingsSchema.safeParse({ ...valid, ...overrides });
    expect(result.success).toBe(false);
    if (!result.success && message) expect(result.error.issues[0].message).toBe(message);
  });
});

describe('converting to and from the database', () => {
  it.each([
    ['16:00:00', 16],
    ['00:00:00', 0],
    ['1 day', 24],
    ['24:00:00', 24],
  ])('reads the interval %s as %i hours', (value, hours) => {
    expect(intervalHours(value)).toBe(hours);
  });

  it('round-trips the form', () => {
    const row = {
      office_name: 'Lagos Office',
      timezone: 'Africa/Lagos',
      weekly_summary_enabled: true,
      weekly_summary_send_time: '18:30:00',
      weekly_summary_send_if_empty: true,
      weekly_summary_late_cutoff: '12:00:00',
      notification_mode: 'live' as const,
      test_redirect_email: null,
      email_from_name: 'Office Reminders',
      email_reply_to: 'office@example.com',
      reminder_lead: '2 days',
      date_only_reminder_time: '08:30:00',
      reminder_min_notice: '03:00:00',
    };
    const form = toSettingsForm(row);
    expect(form).toMatchObject({
      summarySendTime: '18:30',
      summaryLateCutoffHours: 12,
      testRedirectEmail: '',
      reminderLeadHours: 48,
      dateOnlyReminderTime: '08:30',
      reminderMinNoticeHours: 3,
    });
    expect(toSettingsUpdate(settingsSchema.parse(form))).toMatchObject({
      weekly_summary_send_time: '18:30',
      weekly_summary_late_cutoff: '12 hours',
      test_redirect_email: null,
      email_reply_to: 'office@example.com',
      reminder_lead: '48 hours',
      date_only_reminder_time: '08:30',
      reminder_min_notice: '3 hours',
    });
  });
});

describe('nextSummary (office time, Africa/Lagos = UTC+1)', () => {
  const at = (iso: string) => nextSummary({ now: new Date(iso), timeZone: 'Africa/Lagos', sendTime: '17:00' });

  it('on a Wednesday, it is the coming Sunday, covering the week after', () => {
    expect(at('2026-10-21T10:00:00Z')).toEqual({ sendDate: '2026-10-25', periodStart: '2026-10-26' });
  });

  it('on Sunday before the send time, it is today', () => {
    expect(at('2026-10-25T15:59:00Z')).toEqual({ sendDate: '2026-10-25', periodStart: '2026-10-26' });
  });

  it('on Sunday after the send time, it is next Sunday', () => {
    expect(at('2026-10-25T16:00:00Z')).toEqual({ sendDate: '2026-11-01', periodStart: '2026-11-02' });
  });

  it('uses the office date, not UTC: Saturday 23:30 UTC is already Sunday in Lagos', () => {
    expect(at('2026-10-24T23:30:00Z')).toEqual({ sendDate: '2026-10-25', periodStart: '2026-10-26' });
  });
});

describe('nextSummary in an office with clock changes (Europe/London)', () => {
  const at = (iso: string) => nextSummary({ now: new Date(iso), timeZone: 'Europe/London', sendTime: '17:00' });

  it('on the Sunday the clocks go forward, 17:00 is 16:00 UTC', () => {
    expect(at('2027-03-28T15:59:00Z')).toEqual({ sendDate: '2027-03-28', periodStart: '2027-03-29' });
    expect(at('2027-03-28T16:00:00Z')).toEqual({ sendDate: '2027-04-04', periodStart: '2027-04-05' });
  });

  it('on the Sunday the clocks go back, 17:00 is 17:00 UTC', () => {
    expect(at('2027-10-31T16:59:00Z')).toEqual({ sendDate: '2027-10-31', periodStart: '2027-11-01' });
    expect(at('2027-10-31T17:00:00Z')).toEqual({ sendDate: '2027-11-07', periodStart: '2027-11-08' });
  });
});
