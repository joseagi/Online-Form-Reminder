import Link from 'next/link';
import { Suspense } from 'react';
import { Alert } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { getOfficeInfo, listActivities } from '@/lib/activities/data';
import { parseFilters, todayIn } from '@/lib/activities/filters';
import { formatDate, formatTime } from '@/lib/activities/format';
import { firstParam } from '@/lib/forms';

const NOTICES: Record<string, string> = {
  'password-set': 'Your password has been saved.',
};

export default function HomePage({ searchParams }: PageProps<'/'>) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Office Activities</h1>
      <Suspense fallback={<p className="mt-6 text-zinc-500">Loading…</p>}>
        <Welcome searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Welcome({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const user = await requireUser();
  const notice = NOTICES[firstParam((await searchParams).notice) ?? ''];
  const office = await getOfficeInfo();
  const mine = await listActivities({ ...parseFilters({}, todayIn(office.timezone)), person: 'me' }, user.id, 5);

  return (
    <div className="mt-6 space-y-6">
      {notice && <Alert tone="success">{notice}</Alert>}
      <p>
        Welcome, <strong>{user.fullName}</strong>. You are signed in as{' '}
        {user.role === 'admin' ? 'an administrator' : 'a staff member'}.
      </p>
      <p className="flex flex-wrap gap-3">
        <Link
          href="/activities/new"
          className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          New activity
        </Link>
        <Link href="/activities" className="inline-block rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
          All activities
        </Link>
      </p>

      <section>
        <h2 className="mb-2 text-lg font-medium">Your upcoming activities</h2>
        {mine.rows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing coming up that involves you.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {mine.rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-4 px-3 py-2 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">
                  {formatDate(a.activityDate)}
                  {a.startTime ? `, ${formatTime(a.startTime)}` : ''}
                </span>
                <Link href={`/activities/${a.id}`} className="font-medium hover:underline">
                  {a.title}
                </Link>
                {a.status === 'cancelled' && <span className="text-xs text-red-700 dark:text-red-400">Cancelled</span>}
              </li>
            ))}
          </ul>
        )}
        {mine.total > mine.rows.length && (
          <p className="mt-2 text-sm">
            <Link href="/activities?person=me" className="underline">
              See all {mine.total}
            </Link>
          </p>
        )}
      </section>

      {user.role === 'admin' && (
        <p>
          <Link href="/admin/staff" className="underline">
            Manage staff and invitations
          </Link>
        </p>
      )}
    </div>
  );
}
