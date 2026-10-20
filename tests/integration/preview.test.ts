import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

// The summary-preview Edge Function: administrators only.

process.loadEnvFile('.env.local');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const run = Date.now();

async function tokenFor(role: 'admin' | 'staff'): Promise<string> {
  const email = `preview-${role}-${run}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'preview-pass-2026', email_confirm: true, user_metadata: { full_name: `Preview ${role}` },
  });
  if (error) throw error;
  await admin.from('profiles').update({ role, receives_weekly_summary: false }).eq('id', data.user.id);

  const user = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: session, error: signInError } = await user.auth.signInWithPassword({ email, password: 'preview-pass-2026' });
  if (signInError) throw signInError;
  return session.session.access_token;
}

async function preview(token: string | null, periodStart = '2031-01-06') {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/summary-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ periodStart }),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

let adminToken: string;
let staffToken: string;

beforeAll(async () => {
  [adminToken, staffToken] = await Promise.all([tokenFor('admin'), tokenFor('staff')]);
  await preview(adminToken); // warm-up after a stack restart
});

describe('summary-preview Edge Function', () => {
  it('refuses callers without a sign-in token', async () => {
    expect((await preview(null)).status).toBe(401);
  });

  it('refuses signed-in staff who are not administrators', async () => {
    expect((await preview(staffToken)).status).toBe(403);
  });

  it('renders the requested week for an administrator', async () => {
    const { status, body } = await preview(adminToken);
    expect(status).toBe(200);
    expect(body.periodStart).toBe('2031-01-06');
    expect(body.subject).toMatch(/: the week ahead, 6–12 January 2031$/);
    expect(body.html).toContain('The week ahead: 6–12 January 2031');
    expect(body.text).toContain('The week ahead: 6–12 January 2031');
  });

  it('only accepts a Monday', async () => {
    expect((await preview(adminToken, '2031-01-07')).status).toBe(400);
  });
});
