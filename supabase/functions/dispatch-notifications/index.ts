// Notification dispatcher. Called every few minutes by Supabase Cron (pg_cron + pg_net), and only
// with the shared dispatch secret. Each run:
//   1. plans the weekly summaries and reminders (idempotent),
//   2. claims due jobs (leases them, so concurrent runs never share a job),
//   3. builds each message (rendered once, then frozen so retries resend the same payload);
//      reminders are re-checked against the activity on every attempt,
//   4. sends it to the address and through the provider chosen by the test-mode gate (Resend, or
//      only the log), with the job's dedupe key as the idempotency key,
//   5. records the outcome, and logs run.started / run.finished as a heartbeat.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { markAsTest, type RenderedMessage } from '../_shared/message.ts';
import { resolveGate, routeMessage, type Gate, type SettingsMode } from '../_shared/mode.ts';
import { LogProvider, type NotificationProvider } from '../_shared/providers.ts';
import { resendFromEnv } from '../_shared/resend.ts';
import { renderReminder, type ReminderDetails } from '../_shared/reminder.ts';
import { constantTimeEqual } from '../_shared/security.ts';
import { renderWeeklySummary, type SummaryItem } from '../_shared/weekly-summary.ts';

type Job = {
  id: string;
  kind: 'day_before_reminder' | 'weekly_summary' | 'test';
  dedupe_key: string;
  destination: string;
  period_start: string | null;
  scheduled_for: string;
  rendered_subject: string | null;
  rendered_html: string | null;
  rendered_text: string | null;
};

type Settings = {
  office_name: string;
  timezone: string;
  notification_mode: SettingsMode;
  test_redirect_email: string | null;
  email_from_name: string;
  email_reply_to: string | null;
  weekly_summary_send_if_empty: boolean;
  dispatch_batch_size: number;
};

type Counts = {
  planned: number;
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
  // Shown to administrators: which mode this run used, and why if it wasn't the one selected.
  mode?: 'off' | 'test' | 'live';
  warning?: string | null;
  // The email provider configured on this server ('log' when none is).
  provider?: string;
};

// A summary that goes out more than this long after its scheduled time is marked as delayed.
const DELAYED_AFTER_MS = 30 * 60 * 1000;

// The message for a job, or why it is not sent.
type Built = { message: RenderedMessage } | { skip: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function appUrl(): string {
  return Deno.env.get('APP_URL') ?? 'http://localhost:3000';
}

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No service key available to the function');
  return legacy;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('DISPATCH_SECRET');
  if (!expected) return json({ error: 'dispatcher_not_configured' }, 500);
  if (!constantTimeEqual(request.headers.get('x-dispatch-secret') ?? '', expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const runId = crypto.randomUUID();
  const counts: Counts = { planned: 0, claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: 0 };

  await supabase.rpc('log_dispatch_run', { p_run_id: runId, p_event: 'run.started' });
  try {
    await dispatch(supabase, runId, counts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Dispatch run failed:', message);
    await supabase.rpc('log_dispatch_run', { p_run_id: runId, p_event: 'run.failed', p_details: { ...counts, error: message } });
    return json({ runId, ...counts, error: 'run_failed' }, 500);
  }
  await supabase.rpc('log_dispatch_run', { p_run_id: runId, p_event: 'run.finished', p_details: counts });
  return json({ runId, ...counts });
});

async function dispatch(supabase: SupabaseClient, runId: string, counts: Counts): Promise<void> {
  const planned = await supabase.rpc('plan_notifications');
  if (planned.error) throw new Error(`planning failed: ${planned.error.message}`);
  counts.planned = planned.data ?? 0;

  const { data: settings, error: settingsError } = await supabase
    .from('system_settings')
    .select('office_name, timezone, notification_mode, test_redirect_email, email_from_name, email_reply_to, weekly_summary_send_if_empty, dispatch_batch_size')
    .single<Settings>();
  if (settingsError || !settings) throw new Error(`settings unavailable: ${settingsError?.message}`);

  const resend = resendFromEnv((name) => Deno.env.get(name));
  const gate = resolveGate({
    settingsMode: settings.notification_mode,
    notificationsLiveEnv: Deno.env.get('NOTIFICATIONS_LIVE'),
    hasRealProvider: resend.provider !== null,
    testRedirectEmail: settings.test_redirect_email,
  });
  counts.mode = gate.action === 'skip' ? 'off' : gate.mode;
  counts.warning = [gate.action === 'send' && gate.mode === 'test' ? gate.warning : null, resend.warning].filter(Boolean).join(' ') || null;
  counts.provider = resend.provider?.name ?? 'log';
  if (counts.warning) console.warn(counts.warning);

  const claimed = await supabase.rpc('claim_notification_jobs', { p_run_id: runId, p_limit: settings.dispatch_batch_size });
  if (claimed.error) throw new Error(`claiming failed: ${claimed.error.message}`);
  const jobs = (claimed.data ?? []) as Job[];
  counts.claimed = jobs.length;

  const summaries = new Map<string, Promise<SummaryItem[]>>();
  const context = { supabase, runId, settings, gate, provider: resend.provider, log: new LogProvider(), summaries };

  for (const job of jobs) {
    // One job's problem must not stop the others: it is retried later instead.
    let status: string;
    try {
      status = await processJob(context, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Job ${job.id} failed:`, message);
      status = await complete(context, job, { p_outcome: 'retry', p_error_code: 'dispatcher_error', p_error_message: message });
    }
    if (status === 'sent') counts.sent++;
    else if (status === 'pending') counts.retrying++;
    else if (status === 'failed') counts.failed++;
    else counts.skipped++;
  }
}

type Context = {
  supabase: SupabaseClient;
  runId: string;
  settings: Settings;
  gate: Gate;
  // The real email provider, if this server has one; otherwise every message is only logged.
  provider: NotificationProvider | null;
  log: NotificationProvider;
  summaries: Map<string, Promise<SummaryItem[]>>;
};

async function complete(ctx: Context, job: Job, outcome: Record<string, unknown>): Promise<string> {
  const { data, error } = await ctx.supabase.rpc('complete_notification_job', { p_job_id: job.id, p_run_id: ctx.runId, ...outcome });
  if (error) throw new Error(`recording the outcome failed: ${error.message}`);
  return data as string;
}

async function processJob(ctx: Context, job: Job): Promise<string> {
  if (ctx.gate.action === 'skip') return complete(ctx, job, { p_outcome: 'skipped', p_reason: ctx.gate.reason });

  const built = await buildMessage(ctx, job);
  if ('skip' in built) return complete(ctx, job, { p_outcome: 'skipped', p_reason: built.skip });

  const route = routeMessage(ctx.gate, job, ctx.provider !== null);
  // Test requests are always labelled as tests, even when notifications are live.
  const outgoing = route.markAsTest ? markAsTest(built.message, job.destination) : built.message;
  const provider = route.via === 'provider' && ctx.provider ? ctx.provider : ctx.log;

  const result = await provider.send(
    {
      channel: 'email',
      to: route.to,
      ...outgoing,
      fromName: ctx.settings.email_from_name,
      replyTo: ctx.settings.email_reply_to,
    },
    { idempotencyKey: job.dedupe_key },
  );

  if (result.ok) {
    return complete(ctx, job, {
      p_outcome: 'sent',
      p_provider: provider.name,
      p_provider_message_id: result.providerMessageId,
      p_send_mode: ctx.gate.mode,
    });
  }
  return complete(ctx, job, {
    p_outcome: result.retryable ? 'retry' : 'failed',
    p_provider: provider.name,
    p_http_status: result.httpStatus ?? null,
    p_error_code: result.code,
    p_error_message: result.message,
    p_retry_after: result.retryAfterSeconds ? `${result.retryAfterSeconds} seconds` : null,
  });
}

async function buildMessage(ctx: Context, job: Job): Promise<Built> {
  switch (job.kind) {
    case 'weekly_summary':
    case 'test': {
      // "Send test to me" is the coming week's summary, sent even if that week is empty.
      const message = await summaryMessage(ctx, job, { sendIfEmpty: job.kind === 'test' });
      return message ? { message } : { skip: 'empty_week' };
    }
    case 'day_before_reminder':
      return reminderMessage(ctx, job);
    default:
      return { skip: 'unsupported_kind' };
  }
}

async function loadSummaryItems(supabase: SupabaseClient, period: string): Promise<SummaryItem[]> {
  const { data, error } = await supabase.rpc('weekly_summary_items', { p_period_start: period });
  if (error) throw new Error(`summary content unavailable: ${error.message}`);
  return (data ?? []) as SummaryItem[];
}

// The summary for the job's week: the frozen payload on a retry, otherwise rendered now and frozen.
// Returns null for an empty week that should not be sent.
async function summaryMessage(ctx: Context, job: Job, options: { sendIfEmpty: boolean }): Promise<RenderedMessage | null> {
  const stored = storedMessage(job);
  if (stored) return stored;

  const period = job.period_start!;
  // Every subscriber gets the same content: load it once per week per run.
  if (!ctx.summaries.has(period)) ctx.summaries.set(period, loadSummaryItems(ctx.supabase, period));
  const items = await ctx.summaries.get(period)!;
  if (items.length === 0 && !ctx.settings.weekly_summary_send_if_empty && !options.sendIfEmpty) return null;

  return freeze(ctx, job, renderWeeklySummary({
    officeName: ctx.settings.office_name,
    officeTimezone: ctx.settings.timezone,
    periodStart: period,
    items,
    appUrl: appUrl(),
    delayed: Date.now() - new Date(job.scheduled_for).getTime() > DELAYED_AFTER_MS,
  }));
}

// A reminder is checked against the activity on every attempt (it may have been cancelled, moved
// or had the person removed since the job was planned); the message is written at the first one.
async function reminderMessage(ctx: Context, job: Job): Promise<Built> {
  const { data, error } = await ctx.supabase
    .rpc('reminder_details', { p_job_id: job.id })
    .maybeSingle<ReminderDetails & { problem: string | null }>();
  if (error || !data) throw new Error(`reminder details unavailable: ${error?.message ?? 'job not found'}`);
  if (data.problem) return { skip: data.problem };

  const stored = storedMessage(job);
  if (stored) return { message: stored };
  return {
    message: await freeze(ctx, job, renderReminder({
      officeName: ctx.settings.office_name,
      officeTimezone: ctx.settings.timezone,
      appUrl: appUrl(),
      details: data,
    })),
  };
}

function storedMessage(job: Job): RenderedMessage | null {
  return job.rendered_subject && job.rendered_html && job.rendered_text
    ? { subject: job.rendered_subject, html: job.rendered_html, text: job.rendered_text }
    : null;
}

// Stores the first render on the job and returns what is stored, so every retry sends exactly
// the same payload (required for the provider's idempotency key).
async function freeze(ctx: Context, job: Job, rendered: RenderedMessage): Promise<RenderedMessage> {
  const frozen = await ctx.supabase.rpc('freeze_notification_payload', {
    p_job_id: job.id,
    p_subject: rendered.subject,
    p_html: rendered.html,
    p_text: rendered.text,
  });
  const stored = (frozen.data as { subject: string; html: string; body_text: string }[] | null)?.[0];
  if (frozen.error || !stored) throw new Error(`freezing the message failed: ${frozen.error?.message ?? 'job no longer claimed'}`);
  return { subject: stored.subject, html: stored.html, text: stored.body_text };
}
