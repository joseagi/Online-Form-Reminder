// The real email provider: Resend's HTTPS API (POST /emails), checked against resend.com/docs on
// 2026-10-28. Every request carries the job's dedupe key as its Idempotency-Key, so sending the
// same (frozen) message again within 24 hours returns the first result instead of a second email.
import type { NotificationProvider, OutboundMessage, SendResult } from './providers.ts';

const DEFAULT_API_URL = 'https://api.resend.com';
// Resend rejects requests without a User-Agent (403).
const USER_AGENT = 'office-reminders/1.0';
const DEFAULT_TIMEOUT_MS = 10_000;

export type ResendConfig = {
  apiKey: string;
  fromAddress: string;
  apiUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

// Error codes worth trying again later (resend.com/docs/api-reference/errors). Any 5xx is too.
//   429 rate_limit_exceeded / daily_quota_exceeded: the limit resets (per second / at midnight UTC);
//       monthly_quota_exceeded does not reset in time, so it is a permanent failure.
//   409 concurrent_idempotent_requests: an earlier attempt with the same key is still in progress.
//   409 resource_locked: momentary.
// 409 invalid_idempotent_request means the payload differs from the first attempt with this key;
// frozen payloads should make that impossible, so it is a permanent failure to investigate.
const RETRYABLE_CODES = new Set(['rate_limit_exceeded', 'daily_quota_exceeded', 'concurrent_idempotent_requests', 'resource_locked']);

// A display name with RFC 5322 special characters (e.g. a comma) must be quoted. The settings
// already forbid <, > and " in the name.
const NEEDS_QUOTES = /[()<>[\]:;@\\,."]/;

export function formatFrom(name: string, address: string): string {
  const display = NEEDS_QUOTES.test(name) ? `"${name.replace(/[\\"]/g, '\\$&')}"` : name;
  return `${display} <${address}>`;
}

// The request body for one message, addressed to a single recipient.
export function resendPayload(message: OutboundMessage, fromAddress: string): Record<string, unknown> {
  return {
    from: formatFrom(message.fromName, fromAddress),
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
  };
}

// Retry-After is a number of seconds or an HTTP date.
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

// Turns a non-2xx answer into a SendResult. Resend's error body is { statusCode, name, message };
// anything else (e.g. an HTML page from a proxy) is classified by its status alone.
export function classifyError(status: number, body: unknown, retryAfter: string | null): SendResult {
  const error = (body && typeof body === 'object' ? body : {}) as { name?: unknown; message?: unknown };
  const code = typeof error.name === 'string' && error.name ? error.name : `http_${status}`;
  const message = typeof error.message === 'string' && error.message ? error.message : `Resend answered HTTP ${status}.`;
  const retryable = status >= 500 || RETRYABLE_CODES.has(code);
  return {
    ok: false,
    retryable,
    code,
    message: message.slice(0, 1000),
    httpStatus: status,
    ...(retryable ? { retryAfterSeconds: parseRetryAfter(retryAfter) } : {}),
  };
}

export class ResendProvider implements NotificationProvider {
  readonly name = 'resend';

  constructor(private readonly config: ResendConfig) {}

  async send(message: OutboundMessage, options: { idempotencyKey: string }): Promise<SendResult> {
    const doFetch = this.config.fetch ?? fetch;
    let response: Response;
    let body: unknown;
    try {
      response = await doFetch(`${this.config.apiUrl ?? DEFAULT_API_URL}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'Idempotency-Key': options.idempotencyKey,
        },
        body: JSON.stringify(resendPayload(message, this.config.fromAddress)),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      const raw = await response.text();
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    } catch (error) {
      // The request may or may not have reached Resend. Sending it again with the same key is
      // safe: Resend returns the first result if it did.
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      return {
        ok: false,
        retryable: true,
        code: timedOut ? 'timeout' : 'network_error',
        message: timedOut ? 'Resend did not answer in time.' : `Could not reach Resend: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!response.ok) return classifyError(response.status, body, response.headers.get('retry-after'));

    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id) return { ok: true, providerMessageId: id };
    // Accepted without an id: asking again with the same key returns the original answer.
    return { ok: false, retryable: true, code: 'invalid_response', message: 'Resend accepted the request but returned no email id.', httpStatus: response.status };
  }
}

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

// The provider configured by the function's secrets, or null (messages are then only logged).
//   RESEND_API_KEY      the API key (re_...)
//   EMAIL_FROM_ADDRESS  the sender address, on a domain verified in Resend
//   RESEND_API_URL      tests only: points the provider at a fake Resend
export function resendFromEnv(env: (name: string) => string | undefined): { provider: ResendProvider | null; warning: string | null } {
  const apiKey = env('RESEND_API_KEY')?.trim();
  if (!apiKey) return { provider: null, warning: null };
  const fromAddress = env('EMAIL_FROM_ADDRESS')?.trim() ?? '';
  if (!ADDRESS.test(fromAddress)) {
    return { provider: null, warning: 'RESEND_API_KEY is set, but EMAIL_FROM_ADDRESS is missing or not an email address: messages are only logged.' };
  }
  return { provider: new ResendProvider({ apiKey, fromAddress, apiUrl: env('RESEND_API_URL')?.trim() || undefined }), warning: null };
}
