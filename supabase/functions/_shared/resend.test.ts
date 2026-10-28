import { describe, expect, it } from 'vitest';
import type { OutboundMessage } from './providers.ts';
import { classifyError, formatFrom, parseRetryAfter, ResendProvider, resendFromEnv } from './resend.ts';

const message: OutboundMessage = {
  channel: 'email',
  to: 'ada@office.dev',
  subject: 'Reminder: Board meeting',
  html: '<p>Tomorrow</p>',
  text: 'Tomorrow',
  fromName: 'Office Reminders',
  replyTo: 'office@office.dev',
};

type Call = { url: string; init: RequestInit };

// A stand-in for fetch that records each request and answers with the given response.
function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
  return { fn, calls };
}

function provider(answer: () => Response | Promise<Response>) {
  const fake = fakeFetch(answer);
  return { resend: new ResendProvider({ apiKey: 're_test_key', fromAddress: 'reminders@office.dev', fetch: fake.fn }), calls: fake.calls };
}

const errorBody = (status: number, name: string, text = 'Something went wrong') =>
  new Response(JSON.stringify({ statusCode: status, name, message: text }), { status, headers: { 'Content-Type': 'application/json' } });

describe('ResendProvider', () => {
  it('sends one message per request, with the key, a User-Agent and the idempotency key', async () => {
    const { resend, calls } = provider(() => new Response(JSON.stringify({ id: 'email-123' }), { status: 200 }));
    const result = await resend.send(message, { idempotencyKey: 'rem:email:a:p:b:1700000000' });

    expect(result).toEqual({ ok: true, providerMessageId: 'email-123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
      'User-Agent': expect.stringMatching(/\S/),
      'Idempotency-Key': 'rem:email:a:p:b:1700000000',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: 'Office Reminders <reminders@office.dev>',
      to: ['ada@office.dev'],
      subject: 'Reminder: Board meeting',
      html: '<p>Tomorrow</p>',
      text: 'Tomorrow',
      reply_to: 'office@office.dev',
    });
  });

  it('leaves out reply_to when none is set', async () => {
    const { resend, calls } = provider(() => new Response(JSON.stringify({ id: 'x' })));
    await resend.send({ ...message, replyTo: null }, { idempotencyKey: 'k' });
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('reply_to');
  });

  it('sends a byte-identical request when the same message is sent again', async () => {
    const { resend, calls } = provider(() => new Response(JSON.stringify({ id: 'x' })));
    await resend.send(message, { idempotencyKey: 'k' });
    await resend.send(message, { idempotencyKey: 'k' });
    expect(calls[1].init.body).toBe(calls[0].init.body);
  });

  it.each([
    [429, 'rate_limit_exceeded', true],
    [429, 'daily_quota_exceeded', true],
    [429, 'monthly_quota_exceeded', false],
    [409, 'concurrent_idempotent_requests', true],
    [409, 'resource_locked', true],
    [409, 'invalid_idempotent_request', false],
    [500, 'application_error', true],
    [503, 'service_unavailable', true],
    [400, 'validation_error', false],
    [401, 'missing_api_key', false],
    [403, 'validation_error', false],
    [403, 'suspended_api_key', false],
    [422, 'missing_required_field', false],
  ])('classifies HTTP %i %s (retryable: %s)', async (status, name, retryable) => {
    const { resend } = provider(() => errorBody(status, name, 'Resend says no'));
    expect(await resend.send(message, { idempotencyKey: 'k' })).toMatchObject({
      ok: false,
      retryable,
      code: name,
      message: 'Resend says no',
      httpStatus: status,
    });
  });

  it('passes on Retry-After for a temporary failure', async () => {
    const { resend } = provider(() => new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'Slow down' }), { status: 429, headers: { 'retry-after': '7' } }));
    expect(await resend.send(message, { idempotencyKey: 'k' })).toMatchObject({ retryable: true, retryAfterSeconds: 7 });
  });

  it('classifies an answer that is not Resend JSON by its status', async () => {
    const { resend } = provider(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await resend.send(message, { idempotencyKey: 'k' })).toMatchObject({ ok: false, retryable: true, code: 'http_502', httpStatus: 502 });
  });

  it('retries when Resend accepts but returns no id', async () => {
    const { resend } = provider(() => new Response('{}', { status: 200 }));
    expect(await resend.send(message, { idempotencyKey: 'k' })).toMatchObject({ ok: false, retryable: true, code: 'invalid_response' });
  });

  it('retries after a network failure or a timeout (the same key makes that safe)', async () => {
    const offline = provider(() => Promise.reject(new TypeError('fetch failed')));
    expect(await offline.resend.send(message, { idempotencyKey: 'k' })).toMatchObject({ ok: false, retryable: true, code: 'network_error' });

    const slow = provider(() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')));
    expect(await slow.resend.send(message, { idempotencyKey: 'k' })).toMatchObject({ ok: false, retryable: true, code: 'timeout' });
  });

  it('gives up waiting after the timeout', async () => {
    const hanging = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    const resend = new ResendProvider({ apiKey: 'k', fromAddress: 'a@office.dev', fetch: hanging, timeoutMs: 20 });
    expect(await resend.send(message, { idempotencyKey: 'k' })).toMatchObject({ ok: false, retryable: true, code: 'timeout' });
  });

  it('uses another API address when given one (tests)', async () => {
    const fake = fakeFetch(() => new Response(JSON.stringify({ id: 'x' })));
    await new ResendProvider({ apiKey: 'k', fromAddress: 'a@office.dev', apiUrl: 'http://127.0.0.1:9999', fetch: fake.fn }).send(message, { idempotencyKey: 'k' });
    expect(fake.calls[0].url).toBe('http://127.0.0.1:9999/emails');
  });
});

describe('Resend helpers', () => {
  it('quotes a sender name only when it needs it', () => {
    expect(formatFrom('Office Reminders', 'a@office.dev')).toBe('Office Reminders <a@office.dev>');
    expect(formatFrom('Finance, Lagos', 'a@office.dev')).toBe('"Finance, Lagos" <a@office.dev>');
    expect(formatFrom('St. Mary\\s', 'a@office.dev')).toBe('"St. Mary\\\\s" <a@office.dev>');
  });

  it('reads Retry-After as seconds or as a date', () => {
    const now = Date.parse('2026-10-28T10:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter('Wed, 28 Oct 2026 10:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });

  it('cuts very long error messages and leaves out Retry-After for permanent failures', () => {
    const result = classifyError(400, { name: 'validation_error', message: 'x'.repeat(5000) }, '30');
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(result.ok === false && result.message).toHaveLength(1000);
    expect(result).not.toHaveProperty('retryAfterSeconds');
  });
});

describe('resendFromEnv', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it('configures no provider without an API key (messages are only logged)', () => {
    expect(resendFromEnv(env({ EMAIL_FROM_ADDRESS: 'a@office.dev' }))).toEqual({ provider: null, warning: null });
  });

  it('warns and logs only when the key is set but the sender address is missing or invalid', () => {
    for (const from of [undefined, '', 'not-an-address', 'Name <a@office.dev>']) {
      const result = resendFromEnv(env({ RESEND_API_KEY: 're_x', ...(from === undefined ? {} : { EMAIL_FROM_ADDRESS: from }) }));
      expect(result.provider).toBeNull();
      expect(result.warning).toContain('EMAIL_FROM_ADDRESS');
    }
  });

  it('configures Resend when both are set', () => {
    const result = resendFromEnv(env({ RESEND_API_KEY: ' re_x ', EMAIL_FROM_ADDRESS: 'onboarding@resend.dev' }));
    expect(result.warning).toBeNull();
    expect(result.provider?.name).toBe('resend');
  });
});
