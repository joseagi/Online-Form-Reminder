import { escapeHtml } from './html.ts';
import type { RenderedMessage } from './message.ts';
import { localDate, localTime } from './time.ts';

// The failure alert to administrators: the messages that need attention since the last alert.
// Each line links to the message's page in the notification log, where it can be sent again.

export type AlertItem = {
  job_id: string;
  kind: 'day_before_reminder' | 'weekly_summary' | 'test' | 'failure_alert';
  destination: string;
  scheduled_for: string;
  status: string;
  status_reason: string | null;
  delivery_status: string;
  last_error_code: string | null;
  last_error_message: string | null;
  activity_title: string | null;
  period_start: string | null;
};

// An alert lists this many; the rest are on the Notifications page.
export const ALERT_LIST_LIMIT = 20;

const FAILURE_REASONS: Record<string, string> = {
  rejected: 'Refused by the email provider',
  retries_exhausted: 'Gave up after repeated temporary problems',
  outcome_unknown: "Unclear whether it was sent: check the email provider's log before sending it again",
};

const DELIVERY_PROBLEMS: Record<string, string> = {
  bounced: 'Bounced: the address could not receive it',
  complained: 'The recipient marked it as spam',
  failed: 'The email provider could not deliver it',
  suppressed: "Not delivered: the address is on the email provider's suppression list",
};

function describe(item: AlertItem): string {
  if (item.kind === 'weekly_summary') return `Weekly summary${item.period_start ? `, week of ${item.period_start}` : ''}`;
  if (item.kind === 'test') return 'Test message';
  return item.activity_title ? `Reminder: ${item.activity_title.replace(/\s+/g, ' ').trim()}` : 'Day-before reminder';
}

function problem(item: AlertItem): string {
  if (item.status === 'sent') return DELIVERY_PROBLEMS[item.delivery_status] ?? `Reported as ${item.delivery_status}`;
  const reason = FAILURE_REASONS[item.status_reason ?? ''] ?? 'Failed';
  return item.last_error_code ? `${reason} (${item.last_error_code})` : reason;
}

export function renderFailureAlert(input: {
  officeName: string;
  officeTimezone: string;
  appUrl: string;
  items: AlertItem[];
}): RenderedMessage {
  const { officeName, officeTimezone, appUrl, items } = input;
  const count = items.length;
  const subject = `${officeName}: ${count} ${count === 1 ? 'notification needs' : 'notifications need'} attention`;
  const listed = items.slice(0, ALERT_LIST_LIMIT).map((item) => ({
    what: describe(item),
    to: item.destination,
    due: `${localDate(item.scheduled_for, officeTimezone)} ${localTime(item.scheduled_for, officeTimezone)}`,
    problem: problem(item),
    url: `${appUrl}/admin/notifications/${encodeURIComponent(item.job_id)}`,
  }));
  const more = count - listed.length;
  const logUrl = `${appUrl}/admin/notifications?status=failed`;
  const intro =
    count === 1
      ? 'This notification did not get through and needs your attention.'
      : `These ${count} notifications did not get through and need your attention.`;
  const advice = 'Open each one to see what happened. Once the cause is fixed (for example a wrong address), you can send it again from its page.';
  const footer =
    `You receive this because you are an administrator of the ${officeName} activity register. ` +
    'Alerts are sent at most once every 6 hours; the red badge in the app shows problems as they happen.';

  // HTML ----------------------------------------------------------------------------------
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:640px">',
    `<p>${escapeHtml(intro)}</p>`,
    '<ul style="padding-left:20px">',
    ...listed.map(
      (line) =>
        '<li style="margin-bottom:8px">' +
        `<a href="${escapeHtml(line.url)}"><strong>${escapeHtml(line.what)}</strong></a><br>` +
        `To ${escapeHtml(line.to)}, due ${escapeHtml(line.due)} (${escapeHtml(officeTimezone)})<br>` +
        `<span style="color:#b91c1c">${escapeHtml(line.problem)}</span>` +
        '</li>',
    ),
    '</ul>',
    more > 0 ? `<p>…and ${more} more: <a href="${escapeHtml(logUrl)}">see the notification log</a>.</p>` : '',
    `<p>${escapeHtml(advice)}</p>`,
    `<p style="color:#777;font-size:12px;margin-top:24px">${escapeHtml(footer)}</p>`,
    '</div>',
  ].join('');

  // Plain text ------------------------------------------------------------------------------
  const text = [
    intro,
    listed.map((line) => `- ${line.what}\n  To ${line.to}, due ${line.due} (${officeTimezone})\n  ${line.problem}\n  ${line.url}`).join('\n\n'),
    more > 0 ? `...and ${more} more: ${logUrl}` : null,
    advice,
    footer,
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
