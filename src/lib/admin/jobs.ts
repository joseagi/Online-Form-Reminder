// Which action an administrator is offered for one message. The database functions
// (cancel_notification_job, retry_notification_job) enforce the same rules; this only decides
// which button to show.

export type JobForAction = {
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'skipped';
  status_reason: string | null;
  expires_at: string | null;
  attempt_count: number;
};

export type OfferedAction = { action: 'cancel' | 'retry' | 'restore'; warning?: string };

// The database allows at most 20 attempts per message.
const MAX_ATTEMPTS = 20;

export function offeredAction(job: JobForAction, now: Date): OfferedAction | null {
  if (job.status === 'pending') return { action: 'cancel' };

  const beforeDeadline = job.expires_at === null || new Date(job.expires_at) > now;
  if (!beforeDeadline || job.attempt_count >= MAX_ATTEMPTS) return null;

  if (job.status === 'failed') {
    return job.status_reason === 'outcome_unknown'
      ? {
          action: 'retry',
          warning:
            'It is not known whether the last attempt reached the email provider. Check its email log first: ' +
            'if it was sent there more than 24 hours ago, sending it again would deliver it twice.',
        }
      : { action: 'retry' };
  }
  if (job.status === 'cancelled' && job.status_reason === 'cancelled_by_admin') return { action: 'restore' };
  return null;
}
