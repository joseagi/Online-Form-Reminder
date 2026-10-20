// Renders the weekly summary for a chosen week, so administrators can preview it in the app.
// Uses the dispatcher's template, so the preview is exactly what will be sent. Called with the
// administrator's own sign-in token (verify_jwt stays on for this function).
import { createClient } from '@supabase/supabase-js';
import { renderWeeklySummary, type SummaryItem } from '../_shared/weekly-summary.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// The project's default key from SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS, or the legacy one.
function projectKey(dictionary: string, legacy: string): string {
  const keys = Deno.env.get(dictionary);
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  const value = Deno.env.get(legacy);
  if (!value) throw new Error(`Neither ${dictionary} nor ${legacy} is available`);
  return value;
}

function isMonday(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) && date.getUTCDay() === 1;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const options = { auth: { autoRefreshToken: false, persistSession: false } };

  // Who is asking, checked with their own token: administrators only.
  const asCaller = createClient(supabaseUrl, projectKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    ...options,
    global: { headers: { Authorization: authorization } },
  });
  const { data: isAdmin, error: roleError } = await asCaller.rpc('is_admin');
  if (roleError || isAdmin !== true) return json({ error: 'forbidden' }, 403);

  const body = (await request.json().catch(() => ({}))) as { periodStart?: unknown };
  if (!isMonday(body.periodStart)) return json({ error: 'periodStart must be a Monday (YYYY-MM-DD)' }, 400);
  const periodStart = body.periodStart;

  const service = createClient(supabaseUrl, projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), options);
  const [settings, items] = await Promise.all([
    service.from('system_settings').select('office_name, timezone').single<{ office_name: string; timezone: string }>(),
    service.rpc('weekly_summary_items', { p_period_start: periodStart }),
  ]);
  if (settings.error || items.error) {
    return json({ error: 'preview_failed', detail: settings.error?.message ?? items.error?.message }, 500);
  }

  const summaryItems = (items.data ?? []) as SummaryItem[];
  const message = renderWeeklySummary({
    officeName: settings.data.office_name,
    officeTimezone: settings.data.timezone,
    periodStart,
    items: summaryItems,
    appUrl: Deno.env.get('APP_URL') ?? 'http://localhost:3000',
    delayed: false,
  });
  return json({ periodStart, itemCount: summaryItems.length, ...message });
});
