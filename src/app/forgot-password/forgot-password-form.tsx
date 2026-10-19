'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Field, FormStatus, SubmitButton } from '@/components/ui';
import { emptyFormState } from '@/lib/forms';
import { requestPasswordReset } from './actions';

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, emptyFormState);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Enter your work email and we will send you a link to choose a new password.
      </p>
      <FormStatus state={state} />
      <Field label="Email" name="email" type="email" autoComplete="username" required />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
      <p className="text-center text-sm">
        <Link href="/login" className="text-zinc-600 hover:underline dark:text-zinc-400">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
