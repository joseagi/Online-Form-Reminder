import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, dispatch, finishedJob, requireDispatchSecret } from './support';

// The dispatcher Edge Function, end to end against the LOCAL stack: real HTTP call, real database
// functions, log-only provider (nothing is delivered anywhere).

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// A far-future Monday that only this run uses (6 Jan 2031 is a Monday), and the empty week after it.
const run = Date.now();
const PERIOD = addDays('2031-01-06', 14 * (run % 300));
const EMPTY_PERIOD = addDays(PERIOD, 7);

let settingsBefore: Record<string, unknown>;
let userId: string;
const activityIds: string[] = [];
const jobIds: string[] = [];

async function setMode(mode: 'off' | 'test' | 'live') {
  const { error } = await admin.from('system_settings').update({ notification_mode: mode }).eq('id', true);
  if (error) throw error;
}

// A summary job that is due now (inserted directly, so the test doesn't wait for a real Sunday).
async function dueSummaryJob(periodStart: string, label: string): Promise<string> {
  const now = Date.now();
  const { data, error } = await admin
    .from('notification_jobs')
    .insert({
      kind: 'weekly_summary',
      channel: 'email',
      dedupe_key: `sum:email:${periodStart}:it-${run}-${label}`,
      profile_id: userId,
      destination: `int-${run}@example.com`,
      period_start: periodStart,
      scheduled_for: new Date(now - 60_000).toISOString(),
      run_after: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  jobIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  requireDispatchSecret();

  // Warm-up: the Edge Runtime downloads the function's dependencies on its first call after a
  // restart, which can take a while on a slow connection. (Deployed functions are pre-bundled.)
  await dispatch({ secret: 'warm-up' });

  const { data: settings } = await admin.from('system_settings').select('notification_mode, weekly_summary_send_if_empty').single();
  settingsBefore = settings!;
  await admin.from('system_settings').update({ weekly_summary_send_if_empty: false }).eq('id', true);

  const { data: user, error } = await admin.auth.admin.createUser({
    email: `int-${run}@example.com`,
    password: 'integration-pass-2026',
    email_confirm: true,
    user_metadata: { full_name: `Integration ${run}` },
  });
  if (error) throw error;
  userId = user.user.id;
  // Not a summary subscriber, so the real planner leaves this user alone.
  await admin.from('profiles').update({ receives_weekly_summary: false }).eq('id', userId);

  const { data: activity, error: activityError } = await admin
    .from('activities')
    .insert({ title: `Quarterly <b>review</b> ${run}`, activity_date: PERIOD, start_time: '10:00', created_by: userId })
    .select('id')
    .single();
  if (activityError) throw activityError;
  activityIds.push(activity.id);
  await admin.from('activity_recipients').insert({ activity_id: activity.id, profile_id: userId, role: 'responsible' });
});

afterAll(async () => {
  await admin.from('system_settings').update(settingsBefore).eq('id', true);
  if (jobIds.length) await admin.from('notification_jobs').delete().in('id', jobIds);
  // (Including the reminders the activity's own people were given.)
  if (activityIds.length) await admin.from('notification_jobs').delete().in('activity_id', activityIds);
  if (activityIds.length) await admin.from('activities').delete().in('id', activityIds);
});

describe('dispatcher Edge Function', () => {
  it('refuses calls without the dispatch secret', async () => {
    expect((await dispatch({ secret: null })).status).toBe(401);
    expect((await dispatch({ secret: 'wrong-secret' })).status).toBe(401);
    expect((await dispatch({ method: 'GET' })).status).toBe(405);
  });

  it('sends a due summary through the log provider in test mode, with escaped content, and logs the run', async () => {
    await setMode('test');
    const id = await dueSummaryJob(PERIOD, 'test');
    const { status, body } = await dispatch();
    expect(status).toBe(200);

    const job = await finishedJob(id);
    expect(job).toMatchObject({ status: 'sent', provider: 'log', send_mode: 'test', delivery_status: 'unknown' });
    expect(job.provider_message_id).toBe(`log:${job.dedupe_key}`);
    expect(job.rendered_subject).toContain('the week ahead');
    expect(job.rendered_html).toContain(`Quarterly &lt;b&gt;review&lt;/b&gt; ${run}`);
    expect(job.rendered_html).not.toContain('<b>review</b>');
    expect(job.rendered_text).toContain('Responsible: Integration');

    const { data: jobLog } = await admin.from('notification_logs').select('event').eq('job_id', id);
    expect(jobLog!.map((entry) => entry.event)).toEqual(expect.arrayContaining(['claimed', 'accepted']));

    const { data: runLog } = await admin.from('notification_logs').select('event, details').eq('run_id', body.runId as string);
    expect(runLog!.map((entry) => entry.event)).toEqual(expect.arrayContaining(['run.started', 'run.finished']));
  });

  it('stays in test mode when "live" is selected but the server flag is not set', async () => {
    await setMode('live');
    const id = await dueSummaryJob(PERIOD, 'live');
    await dispatch();
    expect(await finishedJob(id)).toMatchObject({ status: 'sent', provider: 'log', send_mode: 'test' });
  });

  it('sends nothing when notifications are switched off', async () => {
    await setMode('off');
    const id = await dueSummaryJob(PERIOD, 'off');
    await dispatch();
    expect(await finishedJob(id)).toMatchObject({ status: 'skipped', status_reason: 'notifications_off', provider: null });
  });

  it('skips an empty week unless the summary is set to send anyway', async () => {
    await setMode('test');
    const id = await dueSummaryJob(EMPTY_PERIOD, 'empty');
    await dispatch();
    expect(await finishedJob(id)).toMatchObject({ status: 'skipped', status_reason: 'empty_week' });
  });
});
