import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { AdminTabs } from '@/app/admin/admin-tabs';
import { requireAdmin } from '@/lib/auth';
import { getNotificationJob, getSettingsRow } from '@/lib/admin/data';
import { STATUS_REASON_LABELS } from '@/lib/admin/settings';
import { isUuid } from '@/lib/activities/schema';
import { formatTimestamp } from '@/lib/activities/format';
import { STATUS_LABELS, STATUS_STYLES, deliveryLabel, describeJob } from '../labels';

export const metadata: Metadata = { title: 'Notification · Office Activities' };

export default function NotificationPage({ params }: PageProps<'/admin/notifications/[id]'>) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <NotificationDetail params={params} />
      </Suspense>
    </main>
  );
}

async function NotificationDetail({ params }: Pick<PageProps<'/admin/notifications/[id]'>, 'params'>) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [job, settings] = await Promise.all([getNotificationJob(id), getSettingsRow()]);
  if (!job) notFound();
  const at = (iso: string | null) => (iso ? formatTimestamp(iso, settings.timezone) : null);

  return (
    <>
      <AdminTabs current="notifications" />
      <p className="mb-4 text-sm">
        <Link href="/admin/notifications" className="text-zinc-600 hover:underline dark:text-zinc-400">
          ← All notifications
        </Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{describeJob(job)}</h1>
      <p className="mb-6 text-zinc-600 dark:text-zinc-400">To {job.destination}</p>

      <dl className="mb-8 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
        <Row label="Status">
          <span className={`rounded-full border px-2 text-xs ${STATUS_STYLES[job.status]}`}>{STATUS_LABELS[job.status]}</span>
          {job.status_reason && <span className="ml-2">{STATUS_REASON_LABELS[job.status_reason] ?? job.status_reason}</span>}
        </Row>
        <Row label="Due">{at(job.scheduled_for)}</Row>
        <Row label="Deadline">{at(job.expires_at)}</Row>
        <Row label="Attempts">{String(job.attempt_count)}</Row>
        <Row label="Accepted by provider">{at(job.accepted_at)}</Row>
        <Row label="Delivery">{deliveryLabel(job)}</Row>
        <Row label="Mode and provider">{[job.send_mode, job.provider].filter(Boolean).join(' · ')}</Row>
        <Row label="Provider message id">{job.provider_message_id}</Row>
        <Row label="Last error">{job.last_error_message}</Row>
        <Row label="Key">{job.dedupe_key}</Row>
      </dl>

      {job.rendered_html ? (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">Message</h2>
          <p className="mb-2 text-sm">
            <span className="text-zinc-500">Subject:</span> <span data-testid="message-subject">{job.rendered_subject}</span>
          </p>
          <iframe
            title="Message content"
            sandbox=""
            srcDoc={job.rendered_html}
            className="h-96 w-full rounded-md border border-zinc-200 bg-white dark:border-zinc-800"
          />
          <p className="mt-2 text-xs text-zinc-500">
            This is the stored message. Messages sent in test mode were also labelled “[TEST]” when they went out.
          </p>
        </section>
      ) : (
        <p className="mb-8 text-sm text-zinc-600 dark:text-zinc-400">No message has been built for this notification.</p>
      )}

      <section>
        <h2 className="mb-2 text-lg font-medium">What happened</h2>
        <ol className="space-y-1 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800" data-testid="notification-events">
          {job.logs.map((entry) => (
            <li key={entry.id}>
              <span className="text-zinc-500">{at(entry.created_at)}</span> · {entry.event}
              {entry.attempt ? ` (attempt ${entry.attempt})` : ''}
              {entry.http_status ? ` · HTTP ${entry.http_status}` : ''}
              {entry.error_message ? ` · ${entry.error_message}` : ''}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <>
      <dt className="font-medium text-zinc-500">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
