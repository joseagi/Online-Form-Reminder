'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Field, FormStatus, SubmitButton } from '@/components/ui';
import { emptyFormState } from '@/lib/forms';
import { signIn } from './actions';

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction, pending] = useActionState(signIn, emptyFormState);

  return (
    <form action={formAction} className="space-y-4">
      {notice && !state.error && <Alert tone="info">{notice}</Alert>}
      <FormStatus state={state} />
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" autoComplete="username" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-zinc-600 hover:underline dark:text-zinc-400">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
