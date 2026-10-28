import 'server-only';
import type { SettingsRow } from '@/lib/admin/settings';
import { createClient } from '@/lib/supabase/server';

// Admin screens. Reads use the signed-in administrator's session (RLS: admins only).

export async function getSettingsRow(): Promise<SettingsRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('system_settings')
    .select(
      'office_name, timezone, weekly_summary_enabled, weekly_summary_send_time, weekly_summary_send_if_empty, ' +
        'weekly_summary_late_cutoff, notification_mode, test_redirect_email, email_from_name, email_reply_to, ' +
        'reminder_lead, date_only_reminder_time, reminder_min_notice',
    )
    .single<SettingsRow>();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  return data;
}

export type SchedulerRun = {
  event: string;
  createdAt: string;
  details: { claimed?: number; sent?: number; skipped?: number; failed?: number; retrying?: number;
             mode?: 'off' | 'test' | 'live'; warning?: string | null; error?: string };
};

// The dispatcher's most recent heartbeat (run.finished or run.failed), or null if it never ran.
export async function getLastSchedulerRun(): Promise<SchedulerRun | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notification_logs')
    .select('event, created_at, details')
    .is('job_id', null)
    .in('event', ['run.finished', 'run.failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load the scheduler status: ${error.message}`);
  return data ? { event: data.event, createdAt: data.created_at, details: data.details as SchedulerRun['details'] } : null;
}

export const JOB_FILTERS = {
  all: null,
  sent: ['sent'],
  waiting: ['pending', 'processing'],
  skipped: ['skipped', 'cancelled'],
  failed: ['failed'],
  // Accepted by the provider, then reported as not delivered (by its webhooks).
  undelivered: ['sent'],
} as const;

// Delivery reports that mean the message did not reach (or was refused by) the recipient.
export const UNDELIVERED_STATUSES = ['bounced', 'complained', 'failed', 'suppressed'] as const;
export type JobFilter = keyof typeof JOB_FILTERS;

const JOB_COLUMNS =
  'id, kind, destination, period_start, activity_id, activity:activities(title), scheduled_for, status, status_reason, ' +
  'attempt_count, provider, send_mode, accepted_at, delivery_status, last_error_message, created_at';

export type JobRow = {
  id: string;
  kind: 'day_before_reminder' | 'weekly_summary' | 'test';
  destination: string;
  period_start: string | null;
  activity_id: string | null;
  activity: { title: string } | null; // reminders: the activity it is about
  scheduled_for: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'skipped';
  status_reason: string | null;
  attempt_count: number;
  provider: string | null;
  send_mode: 'off' | 'test' | 'live' | null;
  accepted_at: string | null;
  delivery_status: string;
  last_error_message: string | null;
  created_at: string;
};

export const JOB_LIST_LIMIT = 100;

// Messages that need an administrator's attention: failed, or reported as not delivered, in the
// last 7 days. Shown as a red count next to Admin and Notifications.
export const PROBLEM_WINDOW_DAYS = 7;

export async function countNotificationProblems(): Promise<number> {
  const supabase = await createClient();
  const since = new Date(Date.now() - PROBLEM_WINDOW_DAYS * 24 * 3_600_000).toISOString();
  const { count, error } = await supabase
    .from('notification_jobs')
    .select('id', { count: 'exact', head: true })
    .gte('updated_at', since)
    .or(`status.eq.failed,and(status.eq.sent,delivery_status.in.(${UNDELIVERED_STATUSES.join(',')}))`);
  if (error) throw new Error(`Could not count notification problems: ${error.message}`);
  return count ?? 0;
}

// Waiting messages: the next one due first. Everything else: the latest due first.
export async function listNotificationJobs(filter: JobFilter, limit = JOB_LIST_LIMIT): Promise<JobRow[]> {
  const supabase = await createClient();
  let query = supabase.from('notification_jobs').select(JOB_COLUMNS);
  const statuses = JOB_FILTERS[filter];
  if (statuses) query = query.in('status', [...statuses]);
  if (filter === 'undelivered') query = query.in('delivery_status', [...UNDELIVERED_STATUSES]);
  const { data, error } = await query
    .order('scheduled_for', { ascending: filter === 'waiting' })
    .order('id')
    .limit(limit)
    .returns<JobRow[]>();
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  return data;
}

export async function getNotificationJob(id: string) {
  const supabase = await createClient();
  const [job, logs] = await Promise.all([
    supabase
      .from('notification_jobs')
      .select(`${JOB_COLUMNS}, dedupe_key, run_after, expires_at, first_attempt_at, provider_message_id, rendered_subject, rendered_html, rendered_text`)
      .eq('id', id)
      .maybeSingle<JobRow & {
        dedupe_key: string; run_after: string; expires_at: string | null; first_attempt_at: string | null;
        provider_message_id: string | null; rendered_subject: string | null; rendered_html: string | null; rendered_text: string | null;
      }>(),
    supabase
      .from('notification_logs')
      .select('id, event, attempt, provider, http_status, error_code, error_message, details, created_at')
      .eq('job_id', id)
      .order('created_at')
      .order('id'),
  ]);
  if (job.error) throw new Error(`Could not load the notification: ${job.error.message}`);
  if (logs.error) throw new Error(`Could not load the notification history: ${logs.error.message}`);
  return job.data ? { ...job.data, logs: logs.data } : null;
}

export type RecipientOption = { id: string; name: string; email: string; detail: string | null; receives: boolean };

export async function getSummaryRecipients(): Promise<{ staff: RecipientOption[]; contacts: RecipientOption[] }> {
  const supabase = await createClient();
  const [staff, contacts] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, receives_weekly_summary').eq('is_active', true).order('full_name'),
    supabase
      .from('contacts')
      .select('id, full_name, organisation, email, receives_weekly_summary')
      .eq('is_active', true)
      .not('email', 'is', null)
      .order('full_name'),
  ]);
  if (staff.error) throw new Error(`Could not load staff: ${staff.error.message}`);
  if (contacts.error) throw new Error(`Could not load contacts: ${contacts.error.message}`);
  return {
    staff: staff.data.map((p) => ({ id: p.id, name: p.full_name, email: p.email, detail: null, receives: p.receives_weekly_summary })),
    contacts: contacts.data.map((c) => ({
      id: c.id, name: c.full_name, email: c.email!, detail: c.organisation, receives: c.receives_weekly_summary,
    })),
  };
}

export type SummaryPreview = { periodStart: string; itemCount: number; subject: string; html: string; text: string };

// Rendered by the summary-preview Edge Function with the dispatcher's own template.
export async function previewSummary(periodStart: string): Promise<SummaryPreview> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke<SummaryPreview>('summary-preview', { body: { periodStart } });
  if (error || !data) throw new Error(`Could not build the preview: ${error?.message ?? 'no response'}`);
  return data;
}
