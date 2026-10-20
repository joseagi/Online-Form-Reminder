import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import {
  calendarHref,
  calendarTitle,
  isSameMonth,
  monthGrid,
  parseCalendarParams,
  shiftAnchor,
  weekDays,
  type CalendarParams,
} from '@/lib/activities/calendar';
import { getOfficeInfo, listActivities, type ActivityListItem } from '@/lib/activities/data';
import { todayIn } from '@/lib/activities/filters';
import { formatDate, formatTime } from '@/lib/activities/format';

export const metadata: Metadata = { title: 'Calendar · Office Activities' };

const MAX_LOADED = 500;
const MAX_PER_DAY = 4;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarPage({ searchParams }: PageProps<'/activities/calendar'>) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Calendar searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Calendar({ searchParams }: Pick<PageProps<'/activities/calendar'>, 'searchParams'>) {
  const user = await requireUser();
  const office = await getOfficeInfo();
  const today = todayIn(office.timezone);
  const params = parseCalendarParams(await searchParams, today);

  const weeks = params.view === 'month' ? monthGrid(params.anchor) : [weekDays(params.anchor)];
  const first = weeks[0][0];
  const last = weeks[weeks.length - 1][6];
  const { rows, total } = await listActivities(
    { q: '', from: first, to: last, status: 'all', person: params.mine ? 'me' : '', order: 'asc', page: 1 },
    user.id,
    MAX_LOADED,
  );

  const byDate = new Map<string, ActivityListItem[]>();
  for (const row of rows) byDate.set(row.activityDate, [...(byDate.get(row.activityDate) ?? []), row]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{calendarTitle(params.view, params.anchor)}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/activities" className="hover:underline">
            List view
          </Link>
          <span aria-hidden="true" className="text-zinc-300">
            |
          </span>
          <Toggle href={calendarHref(params, { view: 'month' })} active={params.view === 'month'}>
            Month
          </Toggle>
          <Toggle href={calendarHref(params, { view: 'week' })} active={params.view === 'week'}>
            Week
          </Toggle>
          <Toggle href={calendarHref(params, { mine: !params.mine })} active={params.mine}>
            Just me
          </Toggle>
        </div>
      </div>

      <nav aria-label="Calendar navigation" className="flex gap-2 text-sm">
        <NavLink href={calendarHref(params, { anchor: shiftAnchor(params.view, params.anchor, -1) })}>Previous</NavLink>
        <NavLink href={calendarHref(params, { anchor: today })}>Today</NavLink>
        <NavLink href={calendarHref(params, { anchor: shiftAnchor(params.view, params.anchor, 1) })}>Next</NavLink>
      </nav>

      {total > rows.length && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Showing the first {rows.length} of {total} activities in this period. Use the list view to see them all.
        </p>
      )}

      {params.view === 'month' ? (
        <MonthGrid weeks={weeks} params={params} today={today} byDate={byDate} />
      ) : (
        <WeekList days={weeks[0]} today={today} byDate={byDate} />
      )}
    </div>
  );
}

function Toggle({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full border px-3 py-1 ${
        active ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900'
      }`}
    >
      {children}
    </Link>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
      {children}
    </Link>
  );
}

function ActivityChip({ activity }: { activity: ActivityListItem }) {
  const cancelled = activity.status === 'cancelled';
  return (
    <Link
      href={`/activities/${activity.id}`}
      className={`block truncate rounded px-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${cancelled ? 'text-zinc-400 line-through' : ''}`}
      title={activity.title}
    >
      <span className="tabular-nums text-zinc-500">{activity.startTime ? formatTime(activity.startTime) : 'All day'}</span>{' '}
      {activity.title}
    </Link>
  );
}

function MonthGrid({
  weeks,
  params,
  today,
  byDate,
}: {
  weeks: string[][];
  params: CalendarParams;
  today: string;
  byDate: Map<string, ActivityListItem[]>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] table-fixed border-collapse text-sm">
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col" className="pb-2 text-left text-xs font-medium text-zinc-500">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => {
                const items = byDate.get(date) ?? [];
                const inMonth = isSameMonth(date, params.anchor);
                return (
                  <td
                    key={date}
                    data-date={date}
                    aria-label={formatDate(date)}
                    className={`h-28 border border-zinc-200 p-1 align-top dark:border-zinc-800 ${inMonth ? '' : 'bg-zinc-50 dark:bg-zinc-900'}`}
                  >
                    <div
                      className={`mb-1 text-xs ${date === today ? 'inline-block rounded-full bg-zinc-900 px-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900' : inMonth ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400'}`}
                    >
                      {Number(date.slice(8))}
                    </div>
                    {items.slice(0, MAX_PER_DAY).map((a) => (
                      <ActivityChip key={a.id} activity={a} />
                    ))}
                    {items.length > MAX_PER_DAY && (
                      <Link
                        href={`/activities?from=${date}&to=${date}${params.mine ? '&person=me' : ''}`}
                        className="block px-1 text-xs text-zinc-600 underline dark:text-zinc-400"
                      >
                        +{items.length - MAX_PER_DAY} more
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekList({ days, today, byDate }: { days: string[]; today: string; byDate: Map<string, ActivityListItem[]> }) {
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {days.map((date) => {
        const items = byDate.get(date) ?? [];
        return (
          <section key={date} data-date={date} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            <h2 className={`mb-2 text-xs font-semibold ${date === today ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'}`}>
              {formatDate(date)}
            </h2>
            {items.length === 0 ? (
              <p className="text-xs text-zinc-400">Nothing scheduled</p>
            ) : (
              <ul className="space-y-1">
                {items.map((a) => (
                  <li key={a.id}>
                    <ActivityChip activity={a} />
                    {a.location && <p className="truncate px-1 text-xs text-zinc-500">{a.location}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
