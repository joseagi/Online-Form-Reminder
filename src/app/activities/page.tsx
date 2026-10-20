import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { Suspense } from 'react';
import { Field, SelectField } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getOfficeInfo, getPeopleOptions, listActivities, type ActivityListItem } from '@/lib/activities/data';
import { PAGE_SIZE, addDays, filtersToQuery, parseFilters, todayIn, type ActivityFilters } from '@/lib/activities/filters';
import { formatDate, formatTime } from '@/lib/activities/format';
import type { StaffOption } from '@/lib/activities/types';

export const metadata: Metadata = { title: 'Activities · Office Activities' };

const primaryButton =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';

export default function ActivitiesPage({ searchParams }: PageProps<'/activities'>) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
        <div className="flex items-center gap-4">
          <Link href="/activities/calendar" className="text-sm hover:underline">
            Calendar view
          </Link>
          <Link href="/activities/new" className={primaryButton}>
            New activity
          </Link>
        </div>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Register searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Register({ searchParams }: Pick<PageProps<'/activities'>, 'searchParams'>) {
  const user = await requireUser();
  const [office, options] = await Promise.all([getOfficeInfo(), getPeopleOptions()]);
  const today = todayIn(office.timezone);
  const filters = parseFilters(await searchParams, today);
  const result = await listActivities(filters, user.id);

  return (
    <div className="space-y-6">
      <nav aria-label="Quick views" className="flex flex-wrap gap-2 text-sm">
        <QuickLink href="/activities">Upcoming</QuickLink>
        <QuickLink href="/activities?person=me">My upcoming</QuickLink>
        <QuickLink href={`/activities?from=&to=${addDays(today, -1)}&order=desc`}>Past</QuickLink>
        <QuickLink href="/activities?from=">All dates</QuickLink>
      </nav>

      <FilterForm filters={filters} staff={options.staff} />

      {result.pageOutOfRange ? (
        <p>
          There is nothing on this page.{' '}
          <Link className="underline" href={`/activities?${filtersToQuery(filters, { page: 1 })}`}>
            Go to the first page
          </Link>
          .
        </p>
      ) : (
        <>
          <Results rows={result.rows} />
          <Pagination filters={filters} total={result.total} shown={result.rows.length} />
        </>
      )}
    </div>
  );
}

function QuickLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
      {children}
    </Link>
  );
}

function FilterForm({ filters, staff }: { filters: ActivityFilters; staff: StaffOption[] }) {
  return (
    // A GET form: the filters live in the URL, so any view can be bookmarked or shared. The key
    // re-creates the fields when the filters change through a link rather than this form.
    <Form
      key={filtersToQuery(filters)}
      action="/activities"
      className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-6 dark:border-zinc-800"
    >
      <div className="sm:col-span-2">
        <Field label="Search" name="q" type="search" defaultValue={filters.q} placeholder="Title, notes, location…" />
      </div>
      <Field label="From" name="from" type="date" defaultValue={filters.from} />
      <Field label="To" name="to" type="date" defaultValue={filters.to} />
      <SelectField label="Status" name="status" defaultValue={filters.status}>
        <option value="all">Any status</option>
        <option value="scheduled">Scheduled</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </SelectField>
      <SelectField label="Person" name="person" defaultValue={filters.person}>
        <option value="">Anyone</option>
        <option value="me">Me</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.fullName}
          </option>
        ))}
      </SelectField>
      {filters.order === 'desc' && <input type="hidden" name="order" value="desc" />}
      <div className="flex items-center gap-4 sm:col-span-6">
        <button type="submit" className={primaryButton}>
          Apply filters
        </button>
        <Link href="/activities" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Reset
        </Link>
      </div>
    </Form>
  );
}

const STATUS_BADGES = {
  completed: 'border-green-300 text-green-800 dark:border-green-800 dark:text-green-300',
  cancelled: 'border-red-300 text-red-800 line-through dark:border-red-800 dark:text-red-300',
} as const;

function Results({ rows }: { rows: ActivityListItem[] }) {
  if (rows.length === 0) return <p className="text-zinc-600 dark:text-zinc-400">No activities match these filters.</p>;

  // Rows arrive in date order; group consecutive rows that share a date.
  const groups: { date: string; items: ActivityListItem[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last?.date === row.activityDate) last.items.push(row);
    else groups.push({ date: row.activityDate, items: [row] });
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.date}>
          <h2 className="mb-2 text-sm font-semibold text-zinc-500">{formatDate(group.date)}</h2>
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {group.items.map((a) => (
              <li key={a.id} data-testid="activity-row" className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2">
                <span className="w-28 shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                  {a.startTime ? `${formatTime(a.startTime)}${a.endTime ? `–${formatTime(a.endTime)}` : ''}` : 'All day'}
                </span>
                <Link href={`/activities/${a.id}`} className="font-medium hover:underline">
                  {a.title}
                </Link>
                {a.status !== 'scheduled' && (
                  <span className={`rounded-full border px-2 text-xs ${STATUS_BADGES[a.status]}`}>
                    {a.status === 'completed' ? 'Completed' : 'Cancelled'}
                  </span>
                )}
                {a.restricted && (
                  <span className="rounded-full border border-zinc-300 px-2 text-xs dark:border-zinc-700">Restricted</span>
                )}
                <span className="text-sm text-zinc-500">
                  {[a.location, a.responsible && `Responsible: ${a.responsible}`].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Pagination({ filters, total, shown }: { filters: ActivityFilters; total: number; shown: number }) {
  if (total <= PAGE_SIZE) return <p className="text-sm text-zinc-500">{total === 1 ? '1 activity' : `${total} activities`}</p>;

  const first = (filters.page - 1) * PAGE_SIZE + 1;
  const hasNext = first + shown - 1 < total;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between text-sm">
      <span className="text-zinc-500">
        Showing {first}–{first + shown - 1} of {total}
      </span>
      <span className="flex gap-4">
        {filters.page > 1 && (
          <Link className="underline" href={`/activities?${filtersToQuery(filters, { page: filters.page - 1 })}`}>
            Previous
          </Link>
        )}
        {hasNext && (
          <Link className="underline" href={`/activities?${filtersToQuery(filters, { page: filters.page + 1 })}`}>
            Next
          </Link>
        )}
      </span>
    </nav>
  );
}
