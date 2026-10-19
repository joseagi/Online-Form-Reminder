import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Alert, AuthCard } from '@/components/ui';
import { firstParam } from '@/lib/forms';
import { ConfirmForm } from './confirm-form';
import { isLinkType } from './link-types';

export const metadata: Metadata = { title: 'Continue · Office Activities' };

export default function ConfirmPage({ searchParams }: PageProps<'/auth/confirm'>) {
  return (
    <AuthCard title="Welcome">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <ConfirmLink searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function ConfirmLink({ searchParams }: Pick<PageProps<'/auth/confirm'>, 'searchParams'>) {
  const params = await searchParams;
  const tokenHash = firstParam(params.token_hash);
  const type = firstParam(params.type);

  if (!tokenHash || !isLinkType(type)) {
    return (
      <div className="space-y-4">
        <Alert tone="error">This link is incomplete. Please use the link from your email.</Alert>
        <p className="text-center text-sm">
          <Link href="/login" className="hover:underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  return <ConfirmForm tokenHash={tokenHash} type={type} />;
}
