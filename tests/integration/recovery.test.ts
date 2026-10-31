import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DENO_DISPATCHER_URL, startDenoDispatcher } from './deno-dispatcher';
import { startFakeResend } from './fake-resend';
import { admin, dispatch, psql, requireDispatchSecret } from './support';

// Outage and recovery (ARCHITECTURE.md §7.6), end to end: the real dispatcher code (run with Deno)
// and the real local database, sending to a fake Resend that can be taken down. "Time passing" is
// simulated by moving a message's next attempt back, instead of waiting for it.

const run = Date.now();
const REDIRECT = 'delivered+recovery@resend.dev'; // Resend's test inbox, in case the stack's own schedule sends one
// A far-future Monday that only this run uses (an empty week; the summary is sent anyway).
const PERIOD = (() => {
  const date = new Date('2043-01-05T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 7 * (run % 500));
  return date.toISOString().slice(0, 10);
})();
const MINUTE = 60_000;

let fake: Awaited<ReturnType<typeof startFakeResend>>;
let dispatcher: Awaited<ReturnType<typeof startDenoDispatcher>>;
let settingsBefore: Record<string, unknown>;
let userId: string;
const jobIds: string[] = [];
const activityIds: string[] = [];

type Job = { id: string; key: string };
type Row = { id: string; status: string; status_reason: string | null; attempt_count: number; run_after: string; last_error_code: string | null };

// A weekly summary that fell due `dueAgo` minutes ago and may go out for `expiresIn` more minutes.
async function summaryJob(label: string, { dueAgo = 1, expiresIn = 60 } = {}): Promise<Job> {
  const now = Date.now();
  const key = `sum:email:${PERIOD}:it-${run}-${label}`;
  const { data, error } = await admin
    .from('notification_jobs')
    .insert({
      kind: 'weekly_summary',
      channel: 'email',
      dedupe_key: key,
      destination: `int-recovery-${run}@example.com`,
      period_start: PERIOD,
      scheduled_for: new Date(now - dueAgo * MINUTE).toISOString(),
      run_after: new Date(now - dueAgo * MINUTE).toISOString(),
      expires_at: new Date(now + expiresIn * MINUTE).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  jobIds.push(data.id);
  return { id: data.id, key };
}

// A reminder that was waiting while its activity started (the scheduler was down meanwhile).
async function reminderForStartedActivity(): Promise<Job> {
  const start = new Date(Date.now() - 60 * MINUTE);
  const { data: activity, error } = await admin
    .from('activities')
    .insert({
      title: `Started during the outage ${run}`,
      activity_date: start.toISOString().slice(0, 10),
      start_time: start.toISOString().slice(11, 16),
      timezone: 'UTC',
      created_by: userId,
    })
    .select('id, starts_at')
    .single();
  if (error) throw error;
  activityIds.push(activity.id);
  const key = `rem:email:${activity.id}:p:${userId}:${Math.floor(Date.parse(activity.starts_at) / 1000)}`;
  const { data, error: jobError } = await admin
    .from('notification_jobs')
    .insert({
      kind: 'day_before_reminder',
      channel: 'email',
      dedupe_key: key,
      activity_id: activity.id,
      profile_id: userId,
      destination: `int-recovery-${run}@example.com`,
      basis_starts_at: activity.starts_at,
      scheduled_for: new Date(Date.parse(activity.starts_at) - 24 * 60 * MINUTE).toISOString(),
      run_after: new Date(Date.parse(activity.starts_at) - 24 * 60 * MINUTE).toISOString(),
      expires_at: activity.starts_at,
    })
    .select('id')
    .single();
  if (jobError) throw jobError;
  jobIds.push(data.id);
  return { id: data.id, key };
}

async function rows(ids: string[]): Promise<Row[]> {
  const { data, error } = await admin.from('notification_jobs').select('id, status, status_reason, attempt_count, run_after, last_error_code').in('id', ids);
  if (error) throw error;
  return data as Row[];
}

// Runs the dispatcher (each run takes at most dispatch_batch_size messages) until every message
// is in the wanted state. Other messages already due in the local queue may take some places.
async function runUntil(ids: string[], done: (row: Row) => boolean, maxRuns = 25): Promise<Row[]> {
  for (let i = 0; i < maxRuns; i++) {
    const current = await rows(ids);
    if (current.length === ids.length && current.every(done)) return current;
    await dispatch({ url: DENO_DISPATCHER_URL });
  }
  throw new Error(`not done after ${maxRuns} dispatcher runs: ${JSON.stringify(await rows(ids))}`);
}
const finished = (row: Row) => !['pending', 'processing'].includes(row.status);

// "Later": the waiting time before the next attempt has passed.
async function timePasses(ids: string[]) {
  const { error } = await admin.from('notification_jobs').update({ run_after: new Date(Date.now() - 1000).toISOString() }).in('id', ids);
  if (error) throw error;
}

const subjectOf = (key: string) => JSON.parse(fake.requestsFor(key)[0].body).subject as string;

beforeAll(async () => {
  requireDispatchSecret();
  const { data: settings } = await admin
    .from('system_settings')
    .select('notification_mode, test_redirect_email, weekly_summary_send_if_empty, dispatch_batch_size')
    .single();
  settingsBefore = settings!;
  await admin
    .from('system_settings')
    .update({ notification_mode: 'test', test_redirect_email: REDIRECT, weekly_summary_send_if_empty: true, dispatch_batch_size: 3 })
    .eq('id', true);

  const { data: user, error } = await admin.auth.admin.createUser({
    email: `int-recovery-${run}@example.com`,
    password: 'integration-pass-2026',
    email_confirm: true,
    user_metadata: { full_name: `Recovery ${run}` },
  });
  if (error) throw error;
  userId = user.user.id;
  await admin.from('profiles').update({ receives_weekly_summary: false }).eq('id', userId);

  fake = await startFakeResend();
  dispatcher = await startDenoDispatcher({ RESEND_API_KEY: 're_fake_key', EMAIL_FROM_ADDRESS: 'onboarding@resend.dev', RESEND_API_URL: fake.url });
});

afterAll(async () => {
  await dispatcher?.kill();
  await fake?.close();
  if (settingsBefore) await admin.from('system_settings').update(settingsBefore).eq('id', true);
  if (jobIds.length) await admin.from('notification_jobs').delete().in('id', jobIds);
  if (activityIds.length) await admin.from('activities').delete().in('id', activityIds);
});

describe('outage and recovery', () => {
  it('catches up on a backlog after missed runs: each message once, late ones marked, expired ones skipped', { timeout: 120_000 }, async () => {
    // While nothing ran: seven summaries fell due, one is two hours late (but before its cutoff),
    // one is past its cutoff, and a reminder's activity has already started.
    const backlog = await Promise.all(Array.from({ length: 7 }, (_, i) => summaryJob(`backlog-${i}`)));
    const late = await summaryJob('late', { dueAgo: 120 });
    const pastCutoff = await summaryJob('past-cutoff', { dueAgo: 18 * 60, expiresIn: -60 });
    const started = await reminderForStartedActivity();

    const first = await dispatch({ url: DENO_DISPATCHER_URL });
    expect(first.body.claimed).toBeLessThanOrEqual(3); // one run takes one batch: catching up takes several

    const sendable = [...backlog, late];
    const done = await runUntil([...sendable, pastCutoff, started].map((job) => job.id), finished);
    const byId = new Map(done.map((row) => [row.id, row]));

    for (const job of sendable) {
      expect(byId.get(job.id)).toMatchObject({ status: 'sent', attempt_count: 1 });
      expect(fake.requestsFor(job.key)).toHaveLength(1);
      expect(fake.sentFor(job.key)).toBeDefined();
    }
    expect(subjectOf(late.key)).toMatch(/^\[TEST\] \(Delayed\) /);
    expect(subjectOf(backlog[0].key)).not.toContain('(Delayed)');

    for (const job of [pastCutoff, started]) {
      expect(byId.get(job.id)).toMatchObject({ status: 'skipped', status_reason: 'expired' });
      expect(fake.requestsFor(job.key)).toHaveLength(0);
    }
  });

  it('retries through a Resend outage and sends each message exactly once afterwards', { timeout: 120_000 }, async () => {
    fake.setOutage({ status: 503, name: 'service_unavailable', message: 'API is temporarily unavailable' });
    const jobs = await Promise.all(Array.from({ length: 4 }, (_, i) => summaryJob(`outage-${i}`)));
    const ids = jobs.map((job) => job.id);

    const before = Date.now();
    const waiting = await runUntil(ids, (row) => row.status === 'pending' && row.attempt_count === 1);
    for (const row of waiting) {
      expect(row).toMatchObject({ status_reason: 'retrying', last_error_code: 'service_unavailable' });
      expect(Date.parse(row.run_after)).toBeGreaterThanOrEqual(before + 55_000); // the first wait: a minute
    }
    for (const job of jobs) expect(fake.sentFor(job.key)).toBeUndefined();

    fake.setOutage(null);
    await timePasses(ids);
    const sent = await runUntil(ids, finished);
    for (const row of sent) expect(row).toMatchObject({ status: 'sent', attempt_count: 2 });
    for (const job of jobs) {
      expect(fake.requestsFor(job.key)).toHaveLength(2);
      expect(fake.sentFor(job.key)).toBeDefined();
    }
  });

  it('gives up when an outage outlasts the deadline, and never sends late', { timeout: 120_000 }, async () => {
    fake.setOutage({ status: 500, name: 'application_error', message: 'An unexpected error occurred.' });
    try {
      const job = await summaryJob('outlasted', { expiresIn: 3 });
      await runUntil([job.id], (row) => row.status === 'pending' && row.attempt_count === 1);
      await timePasses([job.id]);
      // The next wait (5 minutes) would end after the deadline (3 minutes): no further attempt.
      const [failed] = await runUntil([job.id], finished);

      expect(failed).toMatchObject({ status: 'failed', status_reason: 'retries_exhausted', attempt_count: 2, last_error_code: 'application_error' });
      expect(fake.requestsFor(job.key)).toHaveLength(2);
      expect(fake.sentFor(job.key)).toBeUndefined();
    } finally {
      fake.setOutage(null);
    }
  });

  it('hands each message to one run only, even when two claim at the same moment (row locks)', { timeout: 60_000 }, async () => {
    // Due in 2000 and claimed "as of" 2 January 2000 (p_now), so only these are due, and nothing
    // else in the local queue is touched. Their deadline (3 January 2000) has long passed in real
    // time, so the real schedule closes them without sending.
    const keys = Array.from({ length: 4 }, (_, i) => `sum:email:${PERIOD}:it-${run}-race-${i}`);
    const { data, error } = await admin
      .from('notification_jobs')
      .insert(keys.map((key) => ({
        kind: 'weekly_summary', channel: 'email', dedupe_key: key, destination: `int-recovery-${run}@example.com`,
        period_start: PERIOD, scheduled_for: '2000-01-01T00:00:00Z', run_after: '2000-01-01T00:00:00Z', expires_at: '2000-01-03T00:00:00Z',
      })))
      .select('id');
    if (error) throw error;
    const ids = data.map((row) => row.id as string);
    jobIds.push(...ids);

    const claim = `select count(*) from public.claim_notification_jobs(gen_random_uuid(), 10, '2000-01-02 00:00+00');`;
    // The first run claims them and keeps its transaction open for 3 seconds...
    const first = psql(`begin; ${claim} select pg_sleep(3); commit;`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // ...while a second run claims at the same time: it must neither wait nor get the same messages.
    const started = Date.now();
    const second = await psql(claim);
    const firstDone = await first;

    expect(firstDone.output.split('\n')).toContain('4');
    expect(second.output).toBe('0');
    expect(second.finishedAt - started).toBeLessThan(2000); // it skipped the locked rows instead of waiting
    expect(second.finishedAt).toBeLessThan(firstDone.finishedAt);
    const claimed = await rows(ids);
    for (const row of claimed) expect(row).toMatchObject({ status: 'processing', attempt_count: 1 });
  });

  it('never claims or sends a message twice when runs overlap', { timeout: 120_000 }, async () => {
    fake.setDelay(300); // each send takes a while, so the runs below really overlap
    try {
      const jobs = await Promise.all(Array.from({ length: 6 }, (_, i) => summaryJob(`overlap-${i}`)));
      const ids = jobs.map((job) => job.id);

      // The schedule, an administrator's "Send test to me" and a retry can all start a run at once.
      await Promise.all([1, 2, 3].map(() => dispatch({ url: DENO_DISPATCHER_URL })));
      await runUntil(ids, finished);

      for (const job of jobs) {
        expect(fake.requestsFor(job.key)).toHaveLength(1);
        expect(fake.sentFor(job.key)).toBeDefined();
      }
      const { data: log } = await admin
        .from('notification_logs')
        .select('job_id, run_id, event, created_at')
        .in('job_id', ids)
        .in('event', ['claimed', 'accepted']);
      expect(log!.filter((entry) => entry.event === 'claimed')).toHaveLength(ids.length);

      // And the runs did overlap: two of them were working (from claiming to sending) at the same time.
      const windows = new Map<string, { from: number; to: number }>();
      for (const entry of log!) {
        const at = Date.parse(entry.created_at);
        const window = windows.get(entry.run_id) ?? { from: at, to: at };
        windows.set(entry.run_id, { from: Math.min(window.from, at), to: Math.max(window.to, at) });
      }
      const spans = [...windows.values()];
      expect(spans.some((a, i) => spans.some((b, j) => i !== j && a.from < b.to && b.from < a.to))).toBe(true);
    } finally {
      fake.setDelay(0);
    }
  });
});
