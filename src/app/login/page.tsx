import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard } from '@/components/ui';
import { firstParam } from '@/lib/forms';
import { safeNextPath } from '@/lib/safe-redirect';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Office Activities' };

const NOTICES: Record<string, string> = {
  'signed-out': 'You have been signed out.',
};

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <AuthCard title="Sign in">
      {/* Search params are request data, so the form streams in behind a boundary. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <LoginFormForRequest searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function LoginFormForRequest({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const params = await searchParams;
  return (
    <LoginForm
      next={safeNextPath(firstParam(params.next))}
      notice={NOTICES[firstParam(params.notice) ?? '']}
    />
  );
}
