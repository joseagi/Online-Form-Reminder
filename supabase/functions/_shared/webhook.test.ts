import { describe, expect, it } from 'vitest';
import { parseDeliveryReport, sign, verifyWebhook } from './webhook.ts';

// The worked example from docs.svix.com/receiving/verifying-payloads/how-manual: public, not a
// secret. Written without its "whsec_" prefix (which verifyWebhook accepts either way), because
// secret scanners take any whsec_ value in a repository for a leaked Stripe secret.
const svix = {
  secret: 'plJ3nmyCDGBKInavdOK15jsl',
  body: '{"event_type":"ping","data":{"success":true}}',
  id: 'msg_loFOjxBNrRLzqYUf',
  timestamp: '1731705121',
  signature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
};
const at = (seconds: number) => seconds * 1000;

describe('verifyWebhook (Svix signatures, as Resend sends them)', () => {
  it('accepts Svix\'s own example', async () => {
    expect(await verifyWebhook({ ...svix, now: at(1731705121) })).toBe('ok');
  });

  it('accepts the secret as Resend shows it, with the whsec_ prefix', async () => {
    expect(await verifyWebhook({ ...svix, secret: ['whsec', svix.secret].join('_'), now: at(1731705121) })).toBe('ok');
  });

  it('rejects a changed body, id or timestamp', async () => {
    const now = at(1731705121);
    expect(await verifyWebhook({ ...svix, body: svix.body.replace('true', 'false'), now })).toBe('bad_signature');
    expect(await verifyWebhook({ ...svix, id: 'msg_other', now })).toBe('bad_signature');
    expect(await verifyWebhook({ ...svix, timestamp: '1731705122', now })).toBe('bad_signature');
  });

  it('rejects a signature made with another secret', async () => {
    expect(await verifyWebhook({ ...svix, secret: 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', now: at(1731705121) })).toBe('bad_signature');
  });

  it('rejects requests more than 5 minutes old or ahead (replays)', async () => {
    expect(await verifyWebhook({ ...svix, now: at(1731705121 + 300) })).toBe('ok');
    expect(await verifyWebhook({ ...svix, now: at(1731705121 + 301) })).toBe('stale');
    expect(await verifyWebhook({ ...svix, now: at(1731705121 - 301) })).toBe('stale');
    expect(await verifyWebhook({ ...svix, timestamp: 'yesterday', now: at(1731705121) })).toBe('stale');
  });

  it('accepts any matching v1 entry in a list of signatures', async () => {
    const signature = `v1,bm9ldHUjKzFob2VudXRob2VodWUzMjRvdWVvdW9ldQo= v2,MzJsNDk4MzI0K2VvdSMjMTEjQEBAQDEyMzMzMzEyMwo= ${svix.signature}`;
    expect(await verifyWebhook({ ...svix, signature, now: at(1731705121) })).toBe('ok');
    expect(await verifyWebhook({ ...svix, signature: svix.signature.replace('v1,', 'v2,'), now: at(1731705121) })).toBe('bad_signature');
  });

  it('needs all three headers', async () => {
    for (const missing of ['id', 'timestamp', 'signature'] as const) {
      expect(await verifyWebhook({ ...svix, [missing]: null, now: at(1731705121) })).toBe('missing_headers');
    }
  });

  it('reports a secret that is not a signing secret', async () => {
    expect(await verifyWebhook({ ...svix, secret: 'not base64!', now: at(1731705121) })).toBe('bad_secret');
    expect(await verifyWebhook({ ...svix, secret: ['whsec', ''].join('_'), now: at(1731705121) })).toBe('bad_secret');
  });

  it('signs as Svix does (so tests can make valid requests)', async () => {
    expect(`v1,${await sign(svix.secret, svix.id, svix.timestamp, svix.body)}`).toBe(svix.signature);
  });
});

// Shaped like the examples on resend.com/docs/webhooks/emails/*.
const event = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  created_at: '2026-11-22T23:41:12.126Z',
  data: {
    created_at: '2026-11-22T23:41:11.894Z',
    email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
    from: 'Acme <onboarding@resend.dev>',
    to: ['delivered@resend.dev'],
    subject: 'Sending this example',
    ...extra,
  },
});

describe('parseDeliveryReport', () => {
  it('reads the type, the email id and when it happened', () => {
    expect(parseDeliveryReport(event('email.delivered'))).toEqual({
      type: 'email.delivered',
      emailId: '56761188-7520-42d8-8898-ff6fc54ce618',
      occurredAt: '2026-11-22T23:41:12.126Z',
      errorCode: null,
      errorMessage: null,
      details: {},
    });
  });

  it('keeps the reason for a bounce, a failure and a suppression', () => {
    expect(parseDeliveryReport(event('email.bounced', {
      bounce: { message: 'The recipient\'s mailbox does not exist.', subType: 'Suppressed', type: 'Permanent', diagnosticCode: ['smtp; 550 5.1.1'] },
    }))).toMatchObject({ errorCode: 'Permanent', errorMessage: 'The recipient\'s mailbox does not exist.', details: { sub_type: 'Suppressed' } });
    expect(parseDeliveryReport(event('email.failed', { failed: { reason: 'reached_daily_quota' } })))
      .toMatchObject({ errorCode: 'reached_daily_quota', errorMessage: 'reached_daily_quota' });
    expect(parseDeliveryReport(event('email.suppressed', { suppressed: { type: 'OnAccountSuppressionList', message: 'On the suppression list' } })))
      .toMatchObject({ errorCode: 'OnAccountSuppressionList', errorMessage: 'On the suppression list' });
  });

  it('ignores reports that are not about an email', () => {
    expect(parseDeliveryReport({ type: 'domain.updated', created_at: '2026-11-22T23:41:12.126Z', data: { id: 'd-1' } })).toBeNull();
    expect(parseDeliveryReport(event('email.delivered', { email_id: '' }))).toBeNull();
    expect(parseDeliveryReport(null)).toBeNull();
    expect(parseDeliveryReport('email.delivered')).toBeNull();
  });

  it('leaves out an unreadable time instead of guessing', () => {
    expect(parseDeliveryReport({ ...event('email.delivered'), created_at: 'soon' })?.occurredAt).toBeNull();
  });
});
