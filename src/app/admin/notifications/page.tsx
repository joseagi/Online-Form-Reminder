import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AdminTabs } from '@/app/admin/admin-tabs';
import { Alert } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import {
  JOB_FILTERS,
  JOB_LIST_LIMIT,
  getLastSchedulerRun,
  getSettingsRow,
  listNotificationJobs,
  type JobFilter,
  type SchedulerRun,
} from '@/lib/admin/data';
import { STATUS_REASON_LABELS } from '@/lib/admin/settings';
import { formatTimestamp } from '@/lib/activities/format';
import { firstParam } from '@/lib/forms';
import { minutesSince } from '@/lib/time';
import { STATUS_LABELS, STATUS_STYLES, deliveryLabel, describeJob } from './labels';

export const metadata: Metadata = { title: 'Notifications · Office Activities' };

// The scheduler runs every 5 minutes; three missed runs is worth an administrator's attention.
const STALE_AFTER_MINUTES = 15;

const FILTER_LABELS: Record<JobFilter, string> = {
  all: 'All',
  sent: 'Sent',
  waiting: 'Waiting',
  skipped: 'Skipped or cancelled',
  failed: 'Failed',
};

export default function NotificationsPage({ searchParams }: PageProps<'/admin/notifications'>) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <NotificationsAdmin searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function NotificationsAdmin({ searchParams }: Pick<PageProps<'/admin/notifications'>, 'searchParams'>) {
  await requireAdmin();
  const requested = firstParam((await searchParams).status) ?? 'all';
  const filter: JobFilter = requested in JOB_FILTERS ? (requested as JobFilter) : 'all';
  const [settings, lastRun, jobs] = await Promise.all([getSettingsRow(), getLastSchedulerRun(), listNotificationJobs(filter)]);

  return (
    <>
      <AdminTabs current="notifications" />
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Notifications</h1>

      <SchedulerHealth run={lastRun} timeZone={settings.timezone} />

      <nav aria-label="Filter" className="mb-4 mt-8 flex flex-wrap gap-2 text-sm">
        {(Object.keys(FILTER_LABELS) as JobFilter[]).map((key) => (
          <Link
            key={key}
            href={key === 'all' ? '/admin/notifications' : `/admin/notifications?status=${key}`}
            aria-current={key === filter ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 ${key === filter ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900'}`}
          >
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>

      {jobs.length === JOB_LIST_LIMIT && (
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Showing the {JOB_LIST_LIMIT} latest by due time, planned ones first. Use the filters to see others.
        </p>
      )}
      {jobs.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No notifications here yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-4xl text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="py-2 pr-4 font-medium">Due</th>
                <th className="py-2 pr-4 font-medium">Message</th>
                <th className="py-2 pr-4 font-medium">To</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Mode</th>
                <th className="py-2 pr-4 font-medium">Delivery</th>
                <th className="py-2 font-medium"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} data-testid="notification-row" className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatTimestamp(job.scheduled_for, settings.timezone)}</td>
                  <td className="py-2 pr-4">{describeJob(job)}</td>
                  <td className="py-2 pr-4">{job.destination}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full border px-2 text-xs ${STATUS_STYLES[job.status]}`}>{STATUS_LABELS[job.status]}</span>
                    {job.status_reason && (
                      <span className="mt-1 block text-xs text-zinc-500">
                        {STATUS_REASON_LABELS[job.status_reason] ?? job.status_reason}
                      </span>
                    )}
                    {job.last_error_message && job.status !== 'sent' && (
                      <span className="mt-1 block text-xs text-red-700 dark:text-red-400">{job.last_error_message}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{job.send_mode ?? ''}</td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{deliveryLabel(job)}</td>
                  <td className="py-2">
                    <Link href={`/admin/notifications/${job.id}`} className="underline" aria-label={`Details: ${describeJob(job)} to ${job.destination}`}>
                      Details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-zinc-500">Showing the latest {jobs.length}.</p>
        </div>
      )}
    </>
  );
}

function SchedulerHealth({ run, timeZone }: { run: SchedulerRun | null; timeZone: string }) {
  if (!run) {
    return (
      <Alert tone="error">
        The scheduler has not run yet, so no notifications are going out. It runs every 5 minutes once it has been set up.
      </Alert>
    );
  }

  const minutesAgo = minutesSince(run.createdAt);
  const when = `${formatTimestamp(run.createdAt, timeZone)} (${minutesAgo < 1 ? 'just now' : `${minutesAgo} min ago`})`;
  const d = run.details;

  return (
    <section data-testid="scheduler-health" className="space-y-2">
      {minutesAgo > STALE_AFTER_MINUTES && (
        <Alert tone="error">
          The scheduler last ran {minutesAgo} minutes ago. It should run every 5 minutes, so notifications are probably not
          going out. Check that Supabase Cron is running.
        </Alert>
      )}
      {run.event === 'run.failed' && <Alert tone="error">The last run failed: {d.error ?? 'unknown error'}.</Alert>}
      {d.warning && <Alert tone="info">{d.warning}</Alert>}
      <p className="text-sm">
        <span className="font-medium">Last run:</span> {when}
        {d.mode ? ` · ${d.mode} mode` : ''}
        {` · ${d.claimed ?? 0} picked up, ${d.sent ?? 0} sent, ${d.skipped ?? 0} skipped, ${d.failed ?? 0} failed, ${d.retrying ?? 0} retrying`}
      </p>
    </section>
  );
}
