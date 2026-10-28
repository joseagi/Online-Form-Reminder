'use client';

import { useActionState, useState } from 'react';
import { FormStatus, secondaryButtonStyles } from '@/components/ui';
import { emptyFormState } from '@/lib/forms';
import { cancelNotification, retryNotification } from '../actions';

export type JobAction = 'cancel' | 'retry' | 'restore';

// What an administrator can do with one message: cancel it while it waits, send it again after
// it failed, or undo their own cancel (the last two only before its deadline).
export function JobActions({ jobId, action, warning }: { jobId: string; action: JobAction; warning?: string }) {
  const [cancelState, cancelAction, cancelling] = useActionState(cancelNotification, emptyFormState);
  const [retryState, retryAction, retrying] = useActionState(retryNotification, emptyFormState);
  const [confirming, setConfirming] = useState(false);

  if (action === 'cancel') {
    return (
      <form action={cancelAction} className="space-y-3">
        <input type="hidden" name="jobId" value={jobId} />
        {confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Cancel this message? It will not be sent.</span>
            <button type="submit" className={secondaryButtonStyles} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
            </button>
            <button type="button" className="text-sm hover:underline" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" className={secondaryButtonStyles} onClick={() => setConfirming(true)}>
            Cancel this message
          </button>
        )}
        <FormStatus state={cancelState} />
      </form>
    );
  }

  return (
    <form action={retryAction} className="space-y-3">
      <input type="hidden" name="jobId" value={jobId} />
      {warning && <p className="max-w-2xl text-sm text-amber-800 dark:text-amber-300">{warning}</p>}
      <button type="submit" className={secondaryButtonStyles} disabled={retrying}>
        {retrying ? 'Please wait…' : action === 'retry' ? 'Send again' : 'Undo cancel'}
      </button>
      <FormStatus state={retryState} />
    </form>
  );
}
