import Link from 'next/link';
import { Suspense } from 'react';
import { Alert } from '@/components/ui';
import { requireUser } from '@/lib/auth';
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

  return (
    <div className="mt-6 space-y-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      <p>
        Welcome, <strong>{user.fullName}</strong>. You are signed in as{' '}
        {user.role === 'admin' ? 'an administrator' : 'a staff member'}.
      </p>
      <p className="text-zinc-600 dark:text-zinc-400">The activity register arrives in Phase 3.</p>
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
