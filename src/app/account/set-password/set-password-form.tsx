'use client';

import { useActionState } from 'react';
import { Field, FormStatus, SubmitButton } from '@/components/ui';
import { emptyFormState } from '@/lib/forms';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation/auth';
import { setPassword } from './actions';

export function SetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(setPassword, emptyFormState);

  return (
    <form action={formAction} className="space-y-4">
      <FormStatus state={state} />
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={72}
        required
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`}
      />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
      <SubmitButton pending={pending}>Save password</SubmitButton>
    </form>
  );
}
