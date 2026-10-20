import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ActivityForm } from '@/app/activities/activity-form';
import { requireUser } from '@/lib/auth';
import { getOfficeInfo, getPeopleOptions } from '@/lib/activities/data';
import { emptyActivityForm } from '@/lib/activities/schema';

export const metadata: Metadata = { title: 'New activity · Office Activities' };

export default function NewActivityPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New activity</h1>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <NewActivityForm />
      </Suspense>
    </main>
  );
}

async function NewActivityForm() {
  const user = await requireUser();
  const [options, office] = await Promise.all([getPeopleOptions(), getOfficeInfo()]);

  return (
    <ActivityForm
      mode="create"
      initial={emptyActivityForm({ profileId: user.id, name: user.fullName })}
      staffOptions={options.staff}
      contactOptions={options.contacts}
      timezone={office.timezone}
      cancelHref="/"
    />
  );
}
