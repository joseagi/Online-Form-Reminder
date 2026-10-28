import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DENO_DISPATCHER_URL, startDenoDispatcher } from './deno-dispatcher';
import { startFakeResend } from './fake-resend';
import { admin, dispatch, dispatchUntilFinished, requireDispatchSecret } from './support';

// The Resend provider end to end: the real dispatcher code and the real local database, sending
// to a fake Resend that behaves as Resend documents idempotency keys and errors. The dispatcher
// runs directly with Deno so it can be given the fake's address, and be killed mid-send.

const run = Date.now();
// Resend's own test addresses, in case the stack's scheduled dispatcher picks up a job first.
const REDIRECT = 'delivered+redirect@resend.dev';
const OWNER = 'delivered+owner@resend.dev';
const INTENDED = `int-resend-${run}@example.com`;
// A far-future Monday that only this run uses (an empty week; the summary is sent anyway).
const PERIOD = (() => {
  const date = new Date('2041-01-07T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 7 * (run % 500));
  return date.toISOString().slice(0, 10);
})();

let fake: Awaited<ReturnType<typeof startFakeResend>>;
let dispatcher: Awaited<ReturnType<typeof startDenoDispatcher>>;
let settingsBefore: Record<string, unknown>;
const jobIds: string[] = [];

const secrets = () => ({ RESEND_API_KEY: 're_fake_key', EMAIL_FROM_ADDRESS: 'onboarding@resend.dev', RESEND_API_URL: fake.url });
const sendViaDeno = () => dispatch({ url: DENO_DISPATCHER_URL });

async function dueJob(label: string, kind: 'weekly_summary' | 'test' = 'weekly_summary') {
  const now = Date.now();
  const dedupeKey = kind === 'test' ? `test:email:it-${run}-${label}` : `sum:email:${PERIOD}:it-${run}-${label}`;
  const { data, error } = await admin
    .from('notification_jobs')
    .insert({
      kind,
      channel: 'email',
      dedupe_key: dedupeKey,
      destination: kind === 'test' ? OWNER : INTENDED,
      period_start: PERIOD,
      scheduled_for: new Date(now - 60_000).toISOString(),
      run_after: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  jobIds.push(data.id);
  return { id: data.id as string, key: dedupeKey };
}

async function job(id: string) {
  const { data, error } = await admin.from('notification_jobs').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  requireDispatchSecret();
  const { data: settings } = await admin
    .from('system_settings')
    .select('notification_mode, test_redirect_email, weekly_summary_send_if_empty, email_from_name, email_reply_to')
    .single();
  settingsBefore = settings!;
  await admin
    .from('system_settings')
    .update({
      notification_mode: 'test',
      test_redirect_email: REDIRECT,
      weekly_summary_send_if_empty: true,
      email_from_name: 'Integration Office',
      email_reply_to: 'replies@resend.dev',
    })
    .eq('id', true);

  fake = await startFakeResend();
  dispatcher = await startDenoDispatcher(secrets());
});

afterAll(async () => {
  await dispatcher?.kill();
  await fake?.close();
  if (settingsBefore) await admin.from('system_settings').update(settingsBefore).eq('id', true);
  if (jobIds.length) await admin.from('notification_jobs').delete().in('id', jobIds);
});

describe('Resend provider', () => {
  it('sends the frozen message to the test address, with the job key as Idempotency-Key', async () => {
    const { id, key } = await dueJob('basic');
    const sent = await dispatchUntilFinished(id, { url: DENO_DISPATCHER_URL });

    const requests = fake.requestsFor(key);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers).toMatchObject({ authorization: 'Bearer re_fake_key', 'content-type': 'application/json' });
    expect(requests[0].headers['user-agent']).toMatch(/\S/);

    const payload = JSON.parse(requests[0].body);
    expect(payload).toMatchObject({
      from: 'Integration Office <onboarding@resend.dev>',
      to: [REDIRECT],
      reply_to: 'replies@resend.dev',
      subject: `[TEST] ${sent.rendered_subject}`,
    });
    expect(payload.text).toContain(`would have gone to ${INTENDED}`);
    expect(payload.html).toContain('TEST MESSAGE');

    expect(sent).toMatchObject({ status: 'sent', provider: 'resend', send_mode: 'test', provider_message_id: fake.sentFor(key)!.id });
  });

  it('sends no duplicate when the dispatcher crashes after Resend accepted the email', { timeout: 120_000 }, async () => {
    const { id, key } = await dueJob('crash');
    fake.answerNext(key, 'hang');
    const firstRun = sendViaDeno().catch(() => null); // dies with the dispatcher
    await fake.waitForRequest(key);
    await dispatcher.kill();
    await firstRun;

    // Resend has the email; the database never heard back. The job is still leased to the dead run.
    const accepted = fake.sentFor(key)!;
    expect(await job(id)).toMatchObject({ status: 'processing', attempt_count: 1, provider_message_id: null });

    // A new dispatcher, after the lease has run out (moved back here instead of waiting 5 minutes).
    dispatcher = await startDenoDispatcher(secrets());
    await admin.from('notification_jobs').update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', id);
    const retried = await dispatchUntilFinished(id, { url: DENO_DISPATCHER_URL });

    const requests = fake.requestsFor(key);
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toBe(requests[0].body); // the frozen payload, so Resend treats it as the same request
    expect(fake.sentFor(key)).toEqual(accepted); // still the one email
    expect(retried).toMatchObject({ status: 'sent', attempt_count: 2, provider: 'resend', provider_message_id: accepted.id });
  });

  it('waits as long as Resend asks after a rate limit, then tries again', async () => {
    const { id, key } = await dueJob('rate-limited');
    fake.answerNext(key, {
      status: 429,
      body: { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests.' },
      headers: { 'retry-after': '600' },
    });
    const before = Date.now();
    const retrying = await dispatchUntilFinished(id, { url: DENO_DISPATCHER_URL, until: (row) => row.status === 'pending' && row.attempt_count === 1 });

    expect(retrying).toMatchObject({ status_reason: 'retrying', last_error_code: 'rate_limit_exceeded', provider_message_id: null });
    expect(new Date(retrying.run_after).getTime()).toBeGreaterThanOrEqual(before + 595_000);
    const { data: log } = await admin.from('notification_logs').select('event, http_status, error_code').eq('job_id', id).eq('event', 'retry_scheduled');
    expect(log).toEqual([{ event: 'retry_scheduled', http_status: 429, error_code: 'rate_limit_exceeded' }]);
  });

  it('marks a rejected message as failed without retrying', async () => {
    const { id, key } = await dueJob('rejected');
    fake.answerNext(key, { status: 422, body: { statusCode: 422, name: 'validation_error', message: 'Invalid `to` field.' } });
    const failed = await dispatchUntilFinished(id, { url: DENO_DISPATCHER_URL });

    expect(failed).toMatchObject({
      status: 'failed',
      status_reason: 'rejected',
      attempt_count: 1,
      last_error_code: 'validation_error',
      last_error_message: 'Invalid `to` field.',
    });
    expect(fake.requestsFor(key)).toHaveLength(1);
  });

  it('sends "Send test to me" to the administrator who asked, not to the test address', async () => {
    const { id, key } = await dueJob('own-test', 'test');
    const sent = await dispatchUntilFinished(id, { url: DENO_DISPATCHER_URL });

    expect(JSON.parse(fake.requestsFor(key)[0].body)).toMatchObject({ to: [OWNER], subject: expect.stringMatching(/^\[TEST\] /) });
    expect(sent).toMatchObject({ status: 'sent', provider: 'resend' });
  });

  it('only logs messages to a reserved test domain, and never passes them to Resend', async () => {
    await admin.from('system_settings').update({ test_redirect_email: 'qa@example.com' }).eq('id', true);
    try {
      const { id, key } = await dueJob('reserved');
      const logged = await dispatchUntilFinished(id, { url: DENO_DISPATCHER_URL });
      expect(logged).toMatchObject({ status: 'sent', provider: 'log', provider_message_id: `log:${key}` });
      expect(fake.requestsFor(key)).toHaveLength(0);
    } finally {
      await admin.from('system_settings').update({ test_redirect_email: REDIRECT }).eq('id', true);
    }
  });

  it('reports the configured provider in the run summary', async () => {
    const { body } = await sendViaDeno();
    expect(body).toMatchObject({ provider: 'resend', mode: 'test', warning: null });
  });
});
