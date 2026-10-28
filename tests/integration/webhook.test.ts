import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, SUPABASE_URL } from './support';

// The resend-webhook Edge Function end to end against the LOCAL stack: real HTTP requests through
// the API gateway, signed the way Resend (Svix) signs them, recorded in the real database.

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/resend-webhook`;
const SECRET = readFileSync('supabase/functions/.env', 'utf8').match(/^RESEND_WEBHOOK_SECRET=(.+)$/m)?.[1]?.trim();

// Signs as Svix does, independently of the function's own code (docs.svix.com, manual verification).
async function sign(secret: string, id: string, timestamp: string, body: string) {
  return createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
}

const run = Date.now();
const jobIds: string[] = [];
const eventIds: string[] = [];

// A report shaped like resend.com/docs/webhooks/emails/*.
function report(type: string, emailId: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: { email_id: emailId, from: 'Office <onboarding@resend.dev>', to: ['delivered@resend.dev'], subject: 'Reminder', ...extra },
  });
}

let counter = 0;
async function post(
  body: string,
  { id = `msg_it_${run}_${++counter}`, timestamp = String(Math.floor(Date.now() / 1000)), signature }: { id?: string; timestamp?: string; signature?: string | null } = {},
) {
  eventIds.push(id);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp };
  const signed = signature === undefined ? `v1,${await sign(SECRET!, id, timestamp, body)}` : signature;
  if (signed !== null) headers['svix-signature'] = signed;
  const response = await fetch(WEBHOOK_URL, { method: 'POST', headers, body });
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, id };
}

// A message Resend accepted (as the dispatcher would have recorded it).
async function sentJob(label: string) {
  const providerId = `it-email-${run}-${label}`;
  const { data, error } = await admin
    .from('notification_jobs')
    .insert({
      kind: 'test',
      channel: 'email',
      dedupe_key: `test:email:it-${run}-${label}`,
      destination: 'delivered@resend.dev',
      scheduled_for: new Date().toISOString(),
      run_after: new Date().toISOString(),
      status: 'sent',
      provider: 'resend',
      provider_message_id: providerId,
      accepted_at: new Date().toISOString(),
      send_mode: 'test',
    })
    .select('id')
    .single();
  if (error) throw error;
  jobIds.push(data.id);
  return { id: data.id as string, providerId };
}

async function job(id: string) {
  const { data } = await admin.from('notification_jobs').select('delivery_status, delivery_updated_at').eq('id', id).single();
  return data!;
}

beforeAll(async () => {
  if (!SECRET) throw new Error('Run `npm run dispatch:setup` and restart the stack (supabase/functions/.env has no RESEND_WEBHOOK_SECRET).');
  // Warm-up: the Edge Runtime loads a function's dependencies on its first call after a restart.
  await fetch(WEBHOOK_URL, { method: 'POST', body: '{}' });
});

afterAll(async () => {
  if (jobIds.length) await admin.from('notification_jobs').delete().in('id', jobIds);
  if (eventIds.length) await admin.from('notification_logs').delete().in('provider_event_id', eventIds);
});

describe('resend-webhook Edge Function', () => {
  it('refuses requests that are not correctly signed and recent', async () => {
    const body = report('email.delivered', 'it-nothing');
    expect((await fetch(WEBHOOK_URL)).status).toBe(405);
    expect((await post(body, { signature: null })).status).toBe(401);
    expect((await post(body, { signature: 'v1,bm9ldHUjKzFob2VudXRob2VodWUzMjRvdWVvdW9ldQo=' })).status).toBe(401);

    const old = String(Math.floor(Date.now() / 1000) - 600);
    const stale = await post(body, { timestamp: old, signature: `v1,${await sign(SECRET!, 'msg_old', old, body)}`, id: 'msg_old' });
    expect(stale).toMatchObject({ status: 401, body: { reason: 'stale' } });
  });

  it('refuses a body changed after signing (the signature covers the raw body)', async () => {
    const id = `msg_it_${run}_tampered`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const original = report('email.delivered', 'it-nothing');
    const signature = `v1,${await sign(SECRET!, id, timestamp, original)}`;
    expect((await post(original.replace('"type":', '"type" :'), { id, timestamp, signature })).status).toBe(401);
  });

  it('marks a message delivered, and records a redelivered report only once', async () => {
    const { id, providerId } = await sentJob('delivered');
    const first = await post(report('email.delivered', providerId));
    expect(first).toMatchObject({ status: 200, body: { result: 'recorded' } });
    expect((await job(id)).delivery_status).toBe('delivered');

    // Resend retries with the same svix-id (e.g. our answer was lost).
    const again = await post(report('email.delivered', providerId), { id: first.id });
    expect(again).toMatchObject({ status: 200, body: { result: 'duplicate' } });

    const { data: log } = await admin.from('notification_logs').select('event, provider, provider_event_id').eq('job_id', id).like('event', 'email.%');
    expect(log).toEqual([{ event: 'email.delivered', provider: 'resend', provider_event_id: first.id }]);
  });

  it('records a bounce with the receiving server\'s reason', async () => {
    const { id, providerId } = await sentJob('bounced');
    await post(report('email.delivery_delayed', providerId));
    const bounced = await post(report('email.bounced', providerId, {
      bounce: { type: 'Permanent', subType: 'General', message: 'The mailbox does not exist.' },
    }));
    expect(bounced).toMatchObject({ status: 200, body: { result: 'recorded' } });
    expect((await job(id)).delivery_status).toBe('bounced');

    const { data: log } = await admin.from('notification_logs').select('error_code, error_message, details').eq('provider_event_id', bounced.id).single();
    expect(log).toMatchObject({ error_code: 'Permanent', error_message: 'The mailbox does not exist.', details: { sub_type: 'General' } });
  });

  it('acknowledges reports it has no message for, and other signed events', async () => {
    expect(await post(report('email.delivered', `it-unknown-${run}`))).toMatchObject({ status: 200, body: { result: 'unknown_message' } });
    const domainEvent = JSON.stringify({ type: 'domain.updated', created_at: new Date().toISOString(), data: { id: 'd-1' } });
    expect(await post(domainEvent)).toMatchObject({ status: 200, body: { result: 'ignored' } });
  });
});
