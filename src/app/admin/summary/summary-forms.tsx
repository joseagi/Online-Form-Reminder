'use client';

import { useActionState } from 'react';
import { Field, FormStatus, secondaryButtonStyles } from '@/components/ui';
import { emptyFormState } from '@/lib/forms';
import { addSummaryMailbox, sendTestToMe } from './actions';

export function SendTestButton() {
  const [state, formAction, pending] = useActionState(sendTestToMe, emptyFormState);
  return (
    <form action={formAction} className="space-y-3">
      <button type="submit" className={secondaryButtonStyles} disabled={pending}>
        {pending ? 'Queuing…' : 'Send test to me'}
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function AddMailboxForm() {
  const [state, formAction, pending] = useActionState(addSummaryMailbox, emptyFormState);
  return (
    <form action={formAction} className="max-w-xl space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mailbox name" name="name" maxLength={120} placeholder="e.g. Management team" required />
        <Field label="Mailbox email" name="email" type="email" required />
      </div>
      <button type="submit" className={secondaryButtonStyles} disabled={pending}>
        {pending ? 'Adding…' : 'Add mailbox'}
      </button>
      <FormStatus state={state} />
    </form>
  );
}
