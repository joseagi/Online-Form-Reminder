import { addDays } from '@/lib/activities/filters';

// Calendar date arithmetic on plain "YYYY-MM-DD" strings (wall-clock dates, no time zones).
// Weeks start on Monday, matching the Monday-to-Sunday office summary.

export type CalendarView = 'month' | 'week';
export type CalendarParams = { view: CalendarView; anchor: string; mine: boolean };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
type RawParams = Record<string, string | string[] | undefined>;

function one(params: RawParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function utc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRealDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(utc(value).getTime()) && iso(utc(value)) === value;
}

export function parseCalendarParams(params: RawParams, today: string): CalendarParams {
  const date = one(params, 'date');
  return {
    view: one(params, 'view') === 'week' ? 'week' : 'month',
    anchor: date && isRealDate(date) ? date : today,
    mine: one(params, 'mine') === '1',
  };
}

export function startOfWeek(isoDate: string): string {
  const mondayOffset = (utc(isoDate).getUTCDay() + 6) % 7; // Sunday (0) -> 6, Monday (1) -> 0
  return addDays(isoDate, -mondayOffset);
}

export function weekDays(anchor: string): string[] {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function firstOfMonth(anchor: string): string {
  return `${anchor.slice(0, 7)}-01`;
}

// Whole weeks (Monday to Sunday) covering the anchor's month.
export function monthGrid(anchor: string): string[][] {
  const first = utc(firstOfMonth(anchor));
  const last = iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)));
  const weeks: string[][] = [];
  for (let monday = startOfWeek(iso(first)); monday <= last; monday = addDays(monday, 7)) {
    weeks.push(weekDays(monday));
  }
  return weeks;
}

// The anchor one month or one week earlier (step = -1) or later (step = 1).
export function shiftAnchor(view: CalendarView, anchor: string, step: number): string {
  if (view === 'week') return addDays(startOfWeek(anchor), 7 * step);
  const first = utc(firstOfMonth(anchor));
  return iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + step, 1)));
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function calendarHref(params: CalendarParams, overrides: Partial<CalendarParams> = {}): string {
  const p = { ...params, ...overrides };
  const query = new URLSearchParams({ view: p.view, date: p.anchor });
  if (p.mine) query.set('mine', '1');
  return `/activities/calendar?${query.toString()}`;
}

const monthTitle = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

// "December 2026" for a month; "30 November – 6 December 2026" for a week.
export function calendarTitle(view: CalendarView, anchor: string): string {
  if (view === 'month') return monthTitle.format(utc(anchor));
  const days = weekDays(anchor);
  return `${dayMonth.format(utc(days[0]))} – ${dayMonth.format(utc(days[6]))} ${days[6].slice(0, 4)}`;
}
