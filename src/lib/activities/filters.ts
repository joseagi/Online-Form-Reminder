import { z } from 'zod';

// Register filters, read from the page URL (so filtered views can be bookmarked and shared).
// Unknown or malformed values fall back to defaults rather than erroring.

export const STATUS_FILTERS = ['all', 'scheduled', 'completed', 'cancelled'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type ActivityFilters = {
  q: string;
  from: string; // YYYY-MM-DD, or '' for no lower bound
  to: string; // YYYY-MM-DD, or '' for no upper bound
  status: StatusFilter;
  person: string; // '' (anyone), 'me', or a staff profile id
  order: 'asc' | 'desc';
  page: number;
};

export const PAGE_SIZE = 50;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
type RawParams = Record<string, string | string[] | undefined>;

function one(params: RawParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

// "today" is the default lower bound (upcoming activities) when `from` is absent from the URL.
// An empty `from=` means "no lower bound", which is what clearing the date field submits.
export function parseFilters(params: RawParams, today: string): ActivityFilters {
  const date = (key: string, fallback: string) => {
    const value = one(params, key);
    if (value === undefined) return fallback;
    return ISO_DATE.test(value) ? value : '';
  };
  const status = one(params, 'status');
  const person = one(params, 'person') ?? '';
  const page = Number.parseInt(one(params, 'page') ?? '1', 10);

  return {
    q: (one(params, 'q') ?? '').trim().slice(0, 200),
    from: date('from', today),
    to: date('to', ''),
    status: STATUS_FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : 'all',
    person: person === 'me' || z.uuid().safeParse(person).success ? person : '',
    order: one(params, 'order') === 'desc' ? 'desc' : 'asc',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

// URL query string for a set of filters (always explicit, so links reproduce the same view).
export function filtersToQuery(filters: ActivityFilters, overrides: Partial<ActivityFilters> = {}): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.status !== 'all') params.set('status', f.status);
  if (f.person) params.set('person', f.person);
  if (f.order === 'desc') params.set('order', 'desc');
  if (f.page > 1) params.set('page', String(f.page));
  return params.toString();
}

// The calendar date in a time zone, as YYYY-MM-DD.
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
