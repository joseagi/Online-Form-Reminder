import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AdminTabs } from '@/app/admin/admin-tabs';
import { Alert } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { getSettingsRow, getSummaryRecipients, previewSummary, type RecipientOption } from '@/lib/admin/data';
import { nextSummary } from '@/lib/admin/settings';
import { startOfWeek } from '@/lib/activities/calendar';
import { addDays } from '@/lib/activities/filters';
import { formatDate } from '@/lib/activities/format';
import { firstParam } from '@/lib/forms';
import { setSummaryRecipient } from './actions';
import { AddMailboxForm, SendTestButton } from './summary-forms';

export const metadata: Metadata = { title: 'Weekly summary · Office Activities' };

export default function SummaryAdminPage({ searchParams }: PageProps<'/admin/summary'>) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <SummaryAdmin searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SummaryAdmin({ searchParams }: Pick<PageProps<'/admin/summary'>, 'searchParams'>) {
  await requireAdmin();
  const [settings, recipients] = await Promise.all([getSettingsRow(), getSummaryRecipients()]);
  const next = nextSummary({ now: new Date(), timeZone: settings.timezone, sendTime: settings.weekly_summary_send_time });

  // The week to preview: ?week=YYYY-MM-DD (any day; snapped to its Monday), else the coming one.
  const requested = firstParam((await searchParams).week);
  const week = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested))
    ? startOfWeek(requested)
    : next.periodStart;
  // A preview problem must not take the rest of the page (recipients, test send) down with it.
  const preview = await previewSummary(week).catch((error: unknown) => {
    console.error('Summary preview failed:', error);
    return null;
  });

  const receiving = [...recipients.staff, ...recipients.contacts].filter((r) => r.receives).length;

  return (
    <>
      <AdminTabs current="summary" />
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Weekly summary</h1>

      <section className="mb-10 space-y-3">
        {settings.weekly_summary_enabled ? (
          <p>
            The next summary goes out on <strong>{formatDate(next.sendDate)} at {settings.weekly_summary_send_time.slice(0, 5)}</strong>{' '}
            ({settings.timezone}) to <strong>{receiving === 1 ? '1 recipient' : `${receiving} recipients`}</strong>.
          </p>
        ) : (
          <Alert tone="info">The weekly summary is switched off. Turn it on under Settings.</Alert>
        )}
        {settings.notification_mode !== 'live' && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Notifications are in <strong>{settings.notification_mode}</strong> mode, so no one receives real emails yet.
          </p>
        )}
        <SendTestButton />
      </section>

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Preview: week of {formatDate(week)}</h2>
          <nav aria-label="Preview week" className="flex gap-2 text-sm">
            <WeekLink week={addDays(week, -7)}>Previous week</WeekLink>
            <WeekLink week={next.periodStart}>Coming week</WeekLink>
            <WeekLink week={addDays(week, 7)}>Next week</WeekLink>
          </nav>
        </div>
        {preview ? (
          <>
            <p className="mb-2 text-sm">
              <span className="text-zinc-500">Subject:</span> <span data-testid="preview-subject">{preview.subject}</span>
              {' · '}
              {preview.itemCount === 1 ? '1 activity' : `${preview.itemCount} activities`}
            </p>
            {/* Sandboxed: the message is shown as an inert document (no scripts, no access to this page). */}
            <iframe
              title="Summary preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-128 w-full rounded-md border border-zinc-200 bg-white dark:border-zinc-800"
            />
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">Plain-text version</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900">{preview.text}</pre>
            </details>
          </>
        ) : (
          <Alert tone="error">
            The preview is unavailable right now (the summary-preview function did not respond). Everything else on this
            page still works.
          </Alert>
        )}
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-medium">Who receives it</h2>
        <RecipientList title="Staff" kind="staff" people={recipients.staff} />
        <RecipientList title="Other addresses" kind="contact" people={recipients.contacts} />
        <div>
          <h3 className="mb-2 text-sm font-semibold">Add a shared mailbox</h3>
          <AddMailboxForm />
        </div>
      </section>
    </>
  );
}

function WeekLink({ week, children }: { week: string; children: string }) {
  return (
    <Link href={`/admin/summary?week=${week}`} className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
      {children}
    </Link>
  );
}

function RecipientList({ title, kind, people }: { title: string; kind: 'staff' | 'contact'; people: RecipientOption[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {people.length === 0 ? (
        <p className="text-sm text-zinc-500">None yet.</p>
      ) : (
        <ul data-testid={`recipients-${kind}`} className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {people.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{person.name}</span>{' '}
                <span className="text-zinc-500">
                  {person.email}
                  {person.detail ? ` · ${person.detail}` : ''}
                </span>
              </span>
              <form action={setSummaryRecipient} className="flex items-center gap-3">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={person.id} />
                <input type="hidden" name="receives" value={person.receives ? 'false' : 'true'} />
                <span className={person.receives ? 'text-green-700 dark:text-green-400' : 'text-zinc-500'}>
                  {person.receives ? 'Receives it' : 'Does not receive it'}
                </span>
                <button type="submit" className="underline" aria-label={`${person.receives ? 'Stop sending' : 'Start sending'} to ${person.name}`}>
                  {person.receives ? 'Stop' : 'Start'}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
