// Resend webhooks: signature check and parsing. Resend signs with Svix (resend.com/docs/webhooks,
// docs.svix.com/receiving/verifying-payloads/how-manual, checked 2026-10-28):
//   signed content  = `${svix-id}.${svix-timestamp}.${raw body}`
//   signature       = base64(HMAC-SHA256(key = base64-decoded part of the secret after "whsec_"))
//   svix-signature  = space-separated "v1,<signature>" entries; any one may match
// The timestamp must be recent, so a captured request cannot be replayed later.
import { constantTimeEqual } from './security.ts';

export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export type Verification = 'ok' | 'missing_headers' | 'bad_secret' | 'stale' | 'bad_signature';

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function sign(secret: string, id: string, timestamp: string, body: string): Promise<string | null> {
  const key = base64ToBytes(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret);
  if (!key || key.length === 0) return null;
  const hmac = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function verifyWebhook(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
}): Promise<Verification> {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return 'missing_headers';
  if (!/^\d+$/.test(timestamp)) return 'stale';
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > TIMESTAMP_TOLERANCE_SECONDS) return 'stale';

  const expected = await sign(input.secret, id, timestamp, input.body);
  if (!expected) return 'bad_secret';
  const matches = signature
    .split(' ')
    .filter((entry) => entry.startsWith('v1,'))
    .some((entry) => constantTimeEqual(entry.slice(3), expected));
  return matches ? 'ok' : 'bad_signature';
}

// What the database needs from one email.* report. Anything else (other event families,
// malformed payloads) is null and is acknowledged without being recorded.
export type DeliveryReport = {
  type: string;
  emailId: string;
  occurredAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  details: Record<string, string>;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseDeliveryReport(payload: unknown): DeliveryReport | null {
  if (!payload || typeof payload !== 'object') return null;
  const { type, created_at, data } = payload as { type?: unknown; created_at?: unknown; data?: unknown };
  if (typeof type !== 'string' || !type.startsWith('email.') || !data || typeof data !== 'object') return null;
  const event = data as Record<string, unknown>;
  const emailId = text(event.email_id);
  if (!emailId) return null;

  const occurredAt = text(created_at);
  const report: DeliveryReport = {
    type,
    emailId,
    occurredAt: occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? occurredAt : null,
    errorCode: null,
    errorMessage: null,
    details: {},
  };

  // The reason, for the reports that have one (shown in the message's history).
  const bounce = event.bounce as Record<string, unknown> | undefined;
  const failed = event.failed as Record<string, unknown> | undefined;
  const suppressed = event.suppressed as Record<string, unknown> | undefined;
  if (type === 'email.bounced' && bounce && typeof bounce === 'object') {
    report.errorCode = text(bounce.type);
    report.errorMessage = text(bounce.message);
    const subType = text(bounce.subType);
    if (subType) report.details.sub_type = subType;
  } else if (type === 'email.failed' && failed && typeof failed === 'object') {
    report.errorCode = text(failed.reason);
    report.errorMessage = text(failed.reason);
  } else if (type === 'email.suppressed' && suppressed && typeof suppressed === 'object') {
    report.errorCode = text(suppressed.type);
    report.errorMessage = text(suppressed.message);
  }
  return report;
}
