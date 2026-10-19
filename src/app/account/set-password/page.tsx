import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthCard } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { SetPasswordForm } from './set-password-form';

export const metadata: Metadata = { title: 'Choose a password · Office Activities' };

export default function SetPasswordPage() {
  return (
    <AuthCard title="Choose a password">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <SetPasswordForUser />
      </Suspense>
    </AuthCard>
  );
}

async function SetPasswordForUser() {
  const user = await requireUser();
  return <SetPasswordForm email={user.email} />;
}
