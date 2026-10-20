'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { changeActivityStatus, type StatusChangeState } from '@/app/activities/actions';
import { Alert, SubmitButton, TextAreaField, secondaryButtonStyles } from '@/components/ui';
import { statusChangeSchema } from '@/lib/activities/schema';

type Status = 'scheduled' | 'completed' | 'cancelled';

// Complete / cancel / reopen, for people who can edit the activity. `version` is the version
// shown on the page, so a change made by someone else in the meantime is refused, not overwritten.
export function StatusActions({ activityId, status, version }: { activityId: string; status: Status; version: number }) {
  const [state, dispatch, pending] = useActionState<StatusChangeState, Parameters<typeof changeActivityStatus>[1]>(
    changeActivityStatus,
    {},
  );
  const [confirming, setConfirming] = useState<'completed' | 'cancelled' | null>(null);
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function send(next: Status) {
    const input = { activityId, status: next, reason, expectedVersion: version };
    const result = statusChangeSchema.safeParse(input);
    if (!result.success) {
      setLocalError(result.error.issues[0]?.message ?? 'Please try again.');
      return;
    }
    setLocalError(null);
    startTransition(() => dispatch(input));
  }

  function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirming) send(confirming);
  }

  const error = localError ?? state.error;

  if (status !== 'scheduled') {
    return (
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        <button type="button" className={secondaryButtonStyles} disabled={pending} onClick={() => send('scheduled')}>
          {pending ? 'Please wait…' : 'Reopen activity'}
        </button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap gap-3">
        <button type="button" className={secondaryButtonStyles} onClick={() => setConfirming('completed')}>
          Mark as completed
        </button>
        <button type="button" className={secondaryButtonStyles} onClick={() => setConfirming('cancelled')}>
          Cancel activity
        </button>
      </div>
    );
  }

  const cancelling = confirming === 'cancelled';
  return (
    <form onSubmit={onConfirm} noValidate className="max-w-lg space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <TextAreaField
        label={cancelling ? 'Reason for cancelling' : 'Outcome note (optional)'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
        required={cancelling}
      />
      {error && <Alert tone="error">{error}</Alert>}
      <SubmitButton pending={pending}>{cancelling ? 'Confirm cancellation' : 'Confirm completed'}</SubmitButton>
      <button
        type="button"
        className="w-full text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        onClick={() => {
          setConfirming(null);
          setLocalError(null);
        }}
      >
        Go back
      </button>
    </form>
  );
}
