import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { Alert } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { canEditActivity, getActivity, getActivityHistory } from '@/lib/activities/data';
import { formatTimestamp, formatWhen } from '@/lib/activities/format';
import { describeChange, type HistoryEntry } from '@/lib/activities/history';
import { ROLE_LABELS, isUuid } from '@/lib/activities/schema';
import { firstParam } from '@/lib/forms';
import { StatusActions } from './status-actions';

export const metadata: Metadata = { title: 'Activity · Office Activities' };

const STATUS_LABELS = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' } as const;

const NOTICES: Record<string, string> = {
  saved: 'Activity saved.',
  completed: 'Activity marked as completed.',
  cancelled: 'Activity cancelled.',
  scheduled: 'Activity reopened.',
};

export default function ActivityPage({ params, searchParams }: PageProps<'/activities/[id]'>) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ActivityDetail params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ActivityDetail({ params, searchParams }: Pick<PageProps<'/activities/[id]'>, 'params' | 'searchParams'>) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [activity, canEdit, history] = await Promise.all([getActivity(id), canEditActivity(id), getActivityHistory(id)]);
  if (!activity) notFound();
  const notice = NOTICES[firstParam((await searchParams).notice) ?? ''];

  return (
    <article className="space-y-8">
      <p className="text-sm">
        <Link href="/activities" className="text-zinc-600 hover:underline dark:text-zinc-400">
          ← All activities
        </Link>
      </p>
      {notice && <Alert tone="success">{notice}</Alert>}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{activity.title}</h1>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">
            {formatWhen(activity)} <span className="text-sm text-zinc-500">({activity.timezone})</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-zinc-700">
            {STATUS_LABELS[activity.status]}
          </span>
          {canEdit && (
            <Link href={`/activities/${activity.id}/edit`} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
              Edit
            </Link>
          )}
        </div>
      </header>

      {activity.status_reason && (
        <p className="text-sm">
          <span className="font-medium">{activity.status === 'cancelled' ? 'Reason for cancelling' : 'Note'}:</span>{' '}
          {activity.status_reason}
        </p>
      )}

      {canEdit && (
        // Keyed by version so the buttons reset after each change.
        <StatusActions key={activity.version} activityId={activity.id} status={activity.status} version={activity.version} />
      )}

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
        <Detail label="Location">{activity.location}</Detail>
        <Detail label="Meeting link">
          {activity.meeting_url && (
            <a href={activity.meeting_url} target="_blank" rel="noopener noreferrer" className="break-all underline">
              {activity.meeting_url}
            </a>
          )}
        </Detail>
        <Detail label="Contact person">
          {[activity.contact_name, activity.contact_phone, activity.contact_email].filter(Boolean).join(' · ')}
        </Detail>
        <Detail label="Visible to">
          {activity.visibility === 'office' ? 'Everyone in the office' : 'Restricted: the people listed, the creator and admins'}
        </Detail>
        <Detail label="Day-before reminders">{activity.reminders_enabled ? 'On' : 'Off'}</Detail>
        <Detail label="Sunday summary">
          {activity.include_in_weekly_summary && activity.visibility === 'office' ? 'Included' : 'Not included'}
        </Detail>
        <Detail label="Created by">{activity.creator?.full_name}</Detail>
      </dl>

      <TextBlock title="Description">{activity.description}</TextBlock>
      <TextBlock title="Preparation notes">{activity.preparation_notes}</TextBlock>

      <section>
        <h2 className="mb-2 text-lg font-medium">People</h2>
        <ul data-testid="people" className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {activity.people.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{person.profile?.full_name ?? person.contact?.full_name}</span>{' '}
                <span className="text-xs text-zinc-500">
                  {person.profile_id ? 'Staff' : person.contact?.organisation ?? 'External'}
                </span>
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                {ROLE_LABELS[person.role]}
                {person.notify_email ? ' · email reminder' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <History entries={history} timeZone={activity.timezone} />
    </article>
  );
}

function History({ entries, timeZone }: { entries: HistoryEntry[]; timeZone: string }) {
  const lines = entries
    .map((entry) => ({ entry, text: describeChange(entry) }))
    .filter((line): line is { entry: HistoryEntry; text: string } => line.text !== null);
  if (lines.length === 0) return null;

  // Newest first.
  return (
    <section>
      <h2 className="mb-2 text-lg font-medium">History</h2>
      <ol className="space-y-2 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800" data-testid="history">
        {lines.reverse().map(({ entry, text }) => (
          <li key={entry.id}>
            <span className="text-zinc-500">{formatTimestamp(entry.occurred_at, timeZone)}</span>
            {' · '}
            <span className="font-medium">{entry.actor_name}</span> {text}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <>
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </>
  );
}

function TextBlock({ title, children }: { title: string; children: string | null }) {
  if (!children) return null;
  return (
    <section>
      <h2 className="mb-2 text-lg font-medium">{title}</h2>
      <p className="whitespace-pre-line text-sm">{children}</p>
    </section>
  );
}
