import { escapeHtml, multiline, safeHref } from './html.ts';
import type { RenderedMessage } from './message.ts';
import { localDate, zoneNote } from './time.ts';

// The Sunday office summary email. The same content goes to every subscriber, and it never
// lists who receives it.

export type SummaryItem = {
  activity_id: string;
  title: string;
  activity_date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM:SS
  end_time: string | null;
  timezone: string;
  starts_at: string; // the instant (ISO): which office day it falls on, and the office time
  location: string | null;
  meeting_url: string | null;
  preparation_notes: string | null;
  responsible_name: string | null;
  collaborator_names: string[] | null;
};

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayMonthFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function addDays(isoDate: string, days: number): string {
  const date = utcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// "2–8 November 2026", or "28 December 2026 – 3 January 2027" across months/years.
export function weekRange(periodStart: string): string {
  const end = addDays(periodStart, 6);
  const [startYear, endYear] = [periodStart.slice(0, 4), end.slice(0, 4)];
  if (periodStart.slice(0, 7) === end.slice(0, 7)) {
    return `${Number(periodStart.slice(8))}–${dayMonthFormat.format(utcDate(end))} ${endYear}`;
  }
  const startText = dayMonthFormat.format(utcDate(periodStart)) + (startYear === endYear ? '' : ` ${startYear}`);
  return `${startText} – ${dayMonthFormat.format(utcDate(end))} ${endYear}`;
}

function timeLabel(item: SummaryItem, officeTimezone: string): string {
  if (!item.start_time) return 'All day';
  const range = item.end_time ? `${item.start_time.slice(0, 5)}–${item.end_time.slice(0, 5)}` : item.start_time.slice(0, 5);
  return range + zoneNote({ timezone: item.timezone, activityDate: item.activity_date, startsAt: item.starts_at, officeTimezone });
}

// The office day an activity is listed under. The week is chosen in office time, so a timed
// activity goes under the day it starts in the office (a Sunday-night call in London can be
// Monday in Lagos); an all-day activity under its own date.
function officeDay(item: SummaryItem, officeTimezone: string): string {
  return item.start_time ? localDate(item.starts_at, officeTimezone) : item.activity_date;
}

export function renderWeeklySummary(input: {
  officeName: string;
  officeTimezone: string;
  periodStart: string; // the Monday
  items: SummaryItem[];
  appUrl: string;
  delayed: boolean;
}): RenderedMessage {
  const { officeName, officeTimezone, periodStart, items, appUrl, delayed } = input;
  const range = weekRange(periodStart);
  const subject = `${delayed ? '(Delayed) ' : ''}${officeName}: the week ahead, ${range}`;
  const activitiesUrl = `${appUrl}/activities?from=${periodStart}&to=${addDays(periodStart, 6)}`;

  const days: { date: string; items: SummaryItem[] }[] = [];
  // Items arrive in start order, so each office day's items are together.
  for (const item of items) {
    const date = officeDay(item, officeTimezone);
    const last = days[days.length - 1];
    if (last?.date === date) last.items.push(item);
    else days.push({ date, items: [item] });
  }

  const intro = items.length === 0
    ? 'Nothing is scheduled for this week.'
    : `${items.length === 1 ? '1 activity is' : `${items.length} activities are`} scheduled this week.`;
  const delayNote = delayed ? 'This summary is later than usual because of a delay in our systems.' : null;
  const footer =
    `You receive this because you are on the ${officeName} weekly summary list. ` +
    `Times are in ${officeTimezone} unless shown otherwise.`;

  // HTML ----------------------------------------------------------------------------------
  const htmlDays = days.map((day) => {
    const entries = day.items.map((item) => {
      const href = `${appUrl}/activities/${encodeURIComponent(item.activity_id)}`;
      const meeting = item.meeting_url ? safeHref(item.meeting_url) : null;
      const people = [
        item.responsible_name ? `Responsible: ${escapeHtml(item.responsible_name)}` : null,
        item.collaborator_names?.length ? `With: ${escapeHtml(item.collaborator_names.join(', '))}` : null,
      ].filter(Boolean);
      return [
        '<li style="margin:0 0 12px 0">',
        `<strong>${escapeHtml(timeLabel(item, officeTimezone))}</strong> &middot; `,
        `<a href="${escapeHtml(href)}" style="color:#111">${escapeHtml(item.title)}</a>`,
        item.location ? `<br><span style="color:#555">${escapeHtml(item.location)}</span>` : '',
        meeting ? `<br><a href="${meeting}" style="color:#555">Meeting link</a>` : '',
        people.length ? `<br><span style="color:#555">${people.join(' &middot; ')}</span>` : '',
        item.preparation_notes ? `<br><em>Preparation:</em> ${multiline(item.preparation_notes)}` : '',
        '</li>',
      ].join('');
    });
    return `<h2 style="font-size:16px;margin:24px 0 8px">${escapeHtml(dayFormat.format(utcDate(day.date)))}</h2>` +
      `<ul style="padding-left:18px;margin:0">${entries.join('')}</ul>`;
  });

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:640px">',
    `<h1 style="font-size:20px;margin:0 0 4px">The week ahead: ${escapeHtml(range)}</h1>`,
    delayNote ? `<p style="color:#9a3412">${escapeHtml(delayNote)}</p>` : '',
    `<p>${escapeHtml(intro)}</p>`,
    ...htmlDays,
    `<p style="margin-top:24px"><a href="${escapeHtml(activitiesUrl)}">See this week in the activity register</a></p>`,
    `<p style="color:#777;font-size:12px">${escapeHtml(footer)}</p>`,
    '</div>',
  ].join('');

  // Plain text ------------------------------------------------------------------------------
  const textDays = days.map((day) => {
    const entries = day.items.map((item) =>
      [
        `- ${timeLabel(item, officeTimezone)}: ${item.title}`,
        item.location ? `  Where: ${item.location}` : null,
        item.meeting_url ? `  Meeting link: ${item.meeting_url}` : null,
        item.responsible_name ? `  Responsible: ${item.responsible_name}` : null,
        item.collaborator_names?.length ? `  With: ${item.collaborator_names.join(', ')}` : null,
        item.preparation_notes ? `  Preparation: ${item.preparation_notes.replace(/\r?\n/g, ' ')}` : null,
        `  ${appUrl}/activities/${item.activity_id}`,
      ].filter(Boolean).join('\n'),
    );
    return `${dayFormat.format(utcDate(day.date)).toUpperCase()}\n${entries.join('\n')}`;
  });

  const text = [
    `The week ahead: ${range}`,
    delayNote,
    intro,
    ...textDays,
    `See this week in the activity register: ${activitiesUrl}`,
    footer,
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
