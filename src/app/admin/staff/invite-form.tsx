'use client';

import { useActionState } from 'react';
import { Field, FormStatus, SubmitButton } from '@/components/ui';
import { emptyFormState } from '@/lib/forms';
import { inviteStaff } from './actions';

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteStaff, emptyFormState);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <FormStatus state={state} />
      <Field label="Full name" name="fullName" autoComplete="off" maxLength={120} required />
      <Field label="Work email" name="email" type="email" autoComplete="off" required />
      <SubmitButton pending={pending}>Send invitation</SubmitButton>
    </form>
  );
}
