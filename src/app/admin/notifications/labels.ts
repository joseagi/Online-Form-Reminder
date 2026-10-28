import { formatDate } from '@/lib/activities/format';
import { UNDELIVERED_STATUSES, type JobRow } from '@/lib/admin/data';

export const STATUS_LABELS: Record<JobRow['status'], string> = {
  pending: 'Waiting',
  processing: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

export const STATUS_STYLES: Record<JobRow['status'], string> = {
  pending: 'border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300',
  processing: 'border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300',
  sent: 'border-green-300 text-green-800 dark:border-green-800 dark:text-green-300',
  failed: 'border-red-300 text-red-800 dark:border-red-800 dark:text-red-300',
  cancelled: 'border-zinc-300 text-zinc-500 dark:border-zinc-700',
  skipped: 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300',
};

export function describeJob(job: Pick<JobRow, 'kind' | 'period_start' | 'activity'>): string {
  if (job.kind === 'weekly_summary') return `Weekly summary${job.period_start ? `, week of ${formatDate(job.period_start)}` : ''}`;
  if (job.kind === 'test') return 'Test message';
  return job.activity ? `Reminder: ${job.activity.title}` : 'Day-before reminder';
}

const DELIVERY_LABELS: Record<string, string> = {
  unknown: 'Not confirmed',
  delivered: 'Delivered',
  delayed: 'Delayed',
  bounced: 'Bounced',
  complained: 'Marked as spam',
  failed: 'Failed',
  suppressed: 'Suppressed',
};

export function deliveryLabel(job: Pick<JobRow, 'status' | 'delivery_status' | 'provider'>): string {
  if (job.status !== 'sent') return '';
  if (job.provider === 'log') return 'Logged only (test)';
  return DELIVERY_LABELS[job.delivery_status] ?? job.delivery_status;
}

// Red when the provider reported that the message did not get through.
export function deliveryStyle(job: Pick<JobRow, 'status' | 'delivery_status'>): string {
  if (job.status !== 'sent') return '';
  if ((UNDELIVERED_STATUSES as readonly string[]).includes(job.delivery_status)) return 'text-red-700 dark:text-red-400';
  if (job.delivery_status === 'delayed') return 'text-amber-700 dark:text-amber-400';
  return '';
}
