import { escapeHtml, multiline, safeHref } from './html.ts';
import type { RenderedMessage } from './message.ts';

// The day-before reminder: one email for each person listed on an activity, addressed to them
// alone. External contacts have no login, so their copy has no link into the app.

export type ReminderDetails = {
  activity_id: string;
  title: string;
  description: string | null;
  activity_date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM:SS; null = all day
  end_time: string | null;
  timezone: string;
  location: string | null;
  meeting_url: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  preparation_notes: string | null;
  recipient_name: string;
  recipient_role: 'responsible' | 'collaborator' | 'notify_only';
  recipient_is_staff: boolean;
  responsible_name: string | null;
  others: string[] | null; // collaborators other than the recipient
};

const ROLE_LINES: Record<ReminderDetails['recipient_role'], string> = {
  responsible: 'You are responsible for this activity.',
  collaborator: 'You are taking part in this activity.',
  notify_only: 'You are listed on this activity to be kept informed.',
};

const shortDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

// "Tuesday 6 March 2035, 10:00–11:30", with the time zone if it is not the office's. (The year is
// added by hand: with it, Intl's punctuation differs between runtimes.)
function whenLabel(details: ReminderDetails, officeTimezone: string): string {
  const date = `${shortDate.format(utcDate(details.activity_date))} ${details.activity_date.slice(0, 4)}`;
  if (!details.start_time) return `${date} (all day)`;
  const start = details.start_time.slice(0, 5);
  const range = details.end_time ? `${start}–${details.end_time.slice(0, 5)}` : start;
  return `${date}, ${range}${details.timezone === officeTimezone ? '' : ` (${details.timezone})`}`;
}

export function renderReminder(input: {
  officeName: string;
  officeTimezone: string;
  appUrl: string;
  details: ReminderDetails;
}): RenderedMessage {
  const { officeName, officeTimezone, appUrl, details } = input;
  const day = shortDate.format(utcDate(details.activity_date));
  const title = details.title.replace(/\s+/g, ' ').trim(); // a subject is a single line
  const subject = details.start_time
    ? `Reminder: ${title}, ${day} at ${details.start_time.slice(0, 5)}`
    : `Reminder: ${title}, ${day}`;

  const contact = [details.contact_name, details.contact_phone, details.contact_email].filter(Boolean).join(', ');
  const rows: [string, string][] = [['When', whenLabel(details, officeTimezone)]];
  if (details.location) rows.push(['Where', details.location]);
  if (details.recipient_role !== 'responsible' && details.responsible_name) rows.push(['Responsible', details.responsible_name]);
  if (details.others?.length) rows.push(['Also taking part', details.others.join(', ')]);
  if (contact) rows.push(['Contact', contact]);

  const activityUrl = details.recipient_is_staff ? `${appUrl}/activities/${encodeURIComponent(details.activity_id)}` : null;
  const meeting = details.meeting_url ? safeHref(details.meeting_url) : null;
  const footer = details.recipient_is_staff
    ? `You receive this because you are listed on this activity in the ${officeName} activity register.`
    : `You receive this because ${officeName} listed you on this activity.`;
  const intro = `This is a reminder about an upcoming activity. ${ROLE_LINES[details.recipient_role]}`;

  // HTML ----------------------------------------------------------------------------------
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:640px">',
    `<p>Hello ${escapeHtml(details.recipient_name)},</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<h1 style="font-size:20px;margin:16px 0 8px">${escapeHtml(details.title)}</h1>`,
    ...rows.map(([label, value]) => `<p style="margin:0 0 4px"><strong>${label}:</strong> ${escapeHtml(value)}</p>`),
    meeting ? `<p style="margin:0 0 4px"><strong>Meeting link:</strong> <a href="${meeting}">${meeting}</a></p>` : '',
    details.description ? `<h2 style="font-size:16px;margin:20px 0 4px">Details</h2><p style="margin:0">${multiline(details.description)}</p>` : '',
    details.preparation_notes
      ? `<h2 style="font-size:16px;margin:20px 0 4px">Preparation</h2><p style="margin:0">${multiline(details.preparation_notes)}</p>`
      : '',
    activityUrl ? `<p style="margin-top:24px"><a href="${escapeHtml(activityUrl)}">Open this activity</a></p>` : '',
    `<p style="color:#777;font-size:12px;margin-top:24px">${escapeHtml(footer)}</p>`,
    '</div>',
  ].join('');

  // Plain text ------------------------------------------------------------------------------
  const text = [
    `Hello ${details.recipient_name},`,
    intro,
    [
      details.title.toUpperCase(),
      ...rows.map(([label, value]) => `${label}: ${value}`),
      meeting ? `Meeting link: ${details.meeting_url}` : null,
    ].filter(Boolean).join('\n'),
    details.description ? `Details:\n${details.description}` : null,
    details.preparation_notes ? `Preparation:\n${details.preparation_notes}` : null,
    activityUrl ? `Open this activity: ${activityUrl}` : null,
    footer,
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
