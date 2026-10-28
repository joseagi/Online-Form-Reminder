import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Test helpers that act on the LOCAL Supabase stack only.

const MAILPIT_URL = 'http://127.0.0.1:54324';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A unique address per run, because profiles are never deleted.
export function uniqueEmail(label: string) {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export type TestUser = { id: string; email: string; password: string; fullName: string };

export async function createUser(options: {
  email: string;
  password: string;
  fullName: string;
  role?: 'admin' | 'staff';
  active?: boolean;
}): Promise<TestUser> {
  const { data, error } = await admin.auth.admin.createUser({
    email: options.email,
    password: options.password,
    email_confirm: true,
    user_metadata: { full_name: options.fullName },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);

  const { error: updateError } = await admin
    .from('profiles')
    .update({ role: options.role ?? 'staff', is_active: options.active ?? true })
    .eq('id', data.user.id);
  if (updateError) throw new Error(`profile update failed: ${updateError.message}`);

  return { id: data.user.id, email: options.email, password: options.password, fullName: options.fullName };
}

// A Supabase client signed in as `user`, so permissions apply exactly as in the app.
async function clientFor(user: TestUser) {
  const client = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return client;
}

// Creates an activity through the same database function the app uses. Returns its id.
export async function createActivityAs(
  user: TestUser,
  activity: Record<string, unknown>,
  people: Record<string, unknown>[],
): Promise<string> {
  const client = await clientFor(user);
  const { data, error } = await client.rpc('save_activity', { p_activity: activity, p_recipients: people });
  if (error || !data) throw new Error(`save_activity failed: ${error?.message}`);
  return data;
}

export async function setActivityStatusAs(
  user: TestUser,
  activityId: string,
  status: 'scheduled' | 'completed' | 'cancelled',
  reason?: string,
) {
  const client = await clientFor(user);
  const { error } = await client.rpc('set_activity_status', { p_activity_id: activityId, p_status: status, p_reason: reason });
  if (error) throw new Error(`set_activity_status failed: ${error.message}`);
}

// The office settings are shared by the whole local database: save them before a test changes
// them, and put them back afterwards.
export async function readSettings(): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('system_settings').select('*').single();
  if (error) throw new Error(`reading settings failed: ${error.message}`);
  const editable: Record<string, unknown> = { ...data };
  for (const key of ['id', 'updated_at', 'updated_by']) delete editable[key];
  return editable;
}

export async function updateSettings(values: Record<string, unknown>) {
  const { error } = await admin.from('system_settings').update(values).eq('id', true);
  if (error) throw new Error(`updating settings failed: ${error.message}`);
}

// A message that failed after all its attempts, with its deadline an hour away.
export async function failedMessage(destination: string): Promise<string> {
  const { data, error } = await admin
    .from('notification_jobs')
    .insert({
      kind: 'test',
      channel: 'email',
      dedupe_key: `test:email:e2e-failed-${destination}`,
      destination,
      period_start: new Date().toISOString().slice(0, 10),
      scheduled_for: new Date(Date.now() - 3_600_000).toISOString(),
      run_after: new Date(Date.now() - 3_600_000).toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: 'failed',
      status_reason: 'retries_exhausted',
      attempt_count: 6,
      first_attempt_at: new Date(Date.now() - 3_600_000).toISOString(),
      last_error_message: 'Resend did not answer in time.',
    })
    .select('id')
    .single();
  if (error) throw new Error(`creating the failed message failed: ${error.message}`);
  return data.id;
}

// What the 5-minute schedule does first: plan summaries and reminders.
export async function runPlanner() {
  const { error } = await admin.rpc('plan_notifications');
  if (error) throw new Error(`planning failed: ${error.message}`);
}

// A message Resend accepted and then reported as bounced, recorded the way the resend-webhook
// function records it. (The address is never contacted: nothing is sent.)
export async function bouncedMessage(destination: string, reason: string): Promise<string> {
  const providerId = `e2e-${destination}`;
  const { data, error } = await admin
    .from('notification_jobs')
    .insert({
      kind: 'test',
      channel: 'email',
      dedupe_key: `test:email:e2e-${destination}`,
      destination,
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
  if (error) throw new Error(`creating the message failed: ${error.message}`);
  const recorded = await admin.rpc('record_delivery_event', {
    p_provider: 'resend',
    p_event_id: `msg_e2e_${destination}`,
    p_event_type: 'email.bounced',
    p_provider_message_id: providerId,
    p_error_code: 'Permanent',
    p_error_message: reason,
  });
  if (recorded.error) throw new Error(`recording the bounce failed: ${recorded.error.message}`);
  return data.id;
}

export async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
}

// The /auth/confirm link from the newest email sent to `to`, waiting for it to arrive.
export async function emailLinkFor(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages?: { ID: string }[] };
    if (messages?.length) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as {
        HTML: string;
      };
      const href = message.HTML.match(/href="([^"]*\/auth\/confirm\?[^"]*)"/)?.[1];
      if (href) return href.replaceAll('&amp;', '&');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email with a confirmation link arrived for ${to}`);
}
