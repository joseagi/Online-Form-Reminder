import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ActivityForm } from '@/app/activities/activity-form';
import { requireUser } from '@/lib/auth';
import { canEditActivity, getActivity, getPeopleOptions, toFormValues } from '@/lib/activities/data';
import { isUuid } from '@/lib/activities/schema';

export const metadata: Metadata = { title: 'Edit activity · Office Activities' };

export default function EditActivityPage({ params }: PageProps<'/activities/[id]/edit'>) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      {/* Everything, including the heading, waits for the permission check. */}
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <EditActivity params={params} />
      </Suspense>
    </main>
  );
}

async function EditActivity({ params }: Pick<PageProps<'/activities/[id]/edit'>, 'params'>) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [activity, canEdit] = await Promise.all([getActivity(id), canEditActivity(id)]);
  if (!activity || !canEdit) notFound();
  const options = await getPeopleOptions();

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Edit activity</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Status: {activity.status}. To complete, cancel or reopen it, use the buttons on the activity’s page.
      </p>
      <ActivityForm
        mode="edit"
        initial={toFormValues(activity)}
        staffOptions={options.staff}
        contactOptions={options.contacts}
        timezone={activity.timezone}
        cancelHref={`/activities/${activity.id}`}
      />
    </>
  );
}
