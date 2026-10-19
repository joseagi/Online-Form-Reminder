'use client';

import { useActionState } from 'react';
import { FormStatus, SubmitButton } from '@/components/ui';
import { emptyFormState } from '@/lib/forms';
import { confirmEmailLink } from './actions';
import type { LinkType } from './link-types';

const COPY: Record<LinkType, { intro: string; button: string }> = {
  invite: { intro: 'You have been invited to Office Activities. Continue to choose your password.', button: 'Accept invitation' },
  recovery: { intro: 'Continue to choose a new password for your account.', button: 'Continue' },
};

// A button rather than an automatic redirect: some email security scanners open links to check
// them, which would use up the one-time token before the person clicks it.
export function ConfirmForm({ tokenHash, type }: { tokenHash: string; type: LinkType }) {
  const [state, formAction, pending] = useActionState(confirmEmailLink, emptyFormState);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{COPY[type].intro}</p>
      <FormStatus state={state} />
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <SubmitButton pending={pending}>{COPY[type].button}</SubmitButton>
    </form>
  );
}
