// Delivery reports from Resend (webhooks). Resend calls this for each event on a message it
// accepted: delivered, delayed, bounced, complained, failed or suppressed. Each request is
// checked against the webhook's signing secret (Svix signature on the raw body) before anything
// is read from it; then the report is recorded on its message by record_delivery_event, which
// counts each report (svix-id) once, so Resend's retries are harmless.
// Answers: 200 recorded or deliberately ignored; 401 bad signature; 500 not configured or the
// database failed (Resend then retries, for up to about a day).
import { createClient } from '@supabase/supabase-js';
import { parseDeliveryReport, verifyWebhook } from '../_shared/webhook.ts';

// Resend's delivery reports are a few kilobytes; anything far larger is not one.
const MAX_BODY_BYTES = 256 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')?.trim();
  if (!secret) {
    console.error('RESEND_WEBHOOK_SECRET is not set: delivery reports cannot be checked.');
    return json({ error: 'webhook_not_configured' }, 500);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);

  const verification = await verifyWebhook({
    secret,
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    body,
  });
  if (verification === 'bad_secret') {
    console.error('RESEND_WEBHOOK_SECRET is not a valid signing secret (whsec_...).');
    return json({ error: 'webhook_not_configured' }, 500);
  }
  if (verification !== 'ok') return json({ error: 'invalid_signature', reason: verification }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ result: 'ignored', reason: 'not_json' });
  }
  const report = parseDeliveryReport(payload);
  // Signed, but not about an email we could have sent (e.g. a domain event): acknowledge it.
  if (!report) return json({ result: 'ignored' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc('record_delivery_event', {
    p_provider: 'resend',
    p_event_id: request.headers.get('svix-id'),
    p_event_type: report.type,
    p_provider_message_id: report.emailId,
    p_occurred_at: report.occurredAt,
    p_error_code: report.errorCode,
    p_error_message: report.errorMessage,
    p_details: report.details,
  });
  if (error) {
    console.error('Recording a delivery report failed:', error.message);
    return json({ error: 'record_failed' }, 500);
  }
  return json({ result: data });
});
