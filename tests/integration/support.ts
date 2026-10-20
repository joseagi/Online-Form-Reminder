import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Shared by the integration tests, which run against the LOCAL stack only.

process.loadEnvFile('.env.local');
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Normally through the local API gateway (Edge Runtime). DISPATCH_FUNCTION_URL can point at the
// same code run directly with Deno instead (e.g. http://127.0.0.1:8000).
const FUNCTION_URL = process.env.DISPATCH_FUNCTION_URL ?? `${SUPABASE_URL}/functions/v1/dispatch-notifications`;
export const SECRET = readFileSync('supabase/functions/.env', 'utf8').match(/^DISPATCH_SECRET=(.+)$/m)?.[1]?.trim();

export const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Calls the dispatcher. secret: omitted = the real one, null = send no secret header at all.
export async function dispatch({ secret = SECRET, method = 'POST' }: { secret?: string | null; method?: string } = {}) {
  const response = await fetch(FUNCTION_URL, {
    method,
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-dispatch-secret': secret } : {}) },
    body: method === 'POST' ? '{}' : undefined,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export function requireDispatchSecret() {
  if (!SECRET) throw new Error('Run `npm run dispatch:setup` first (supabase/functions/.env has no DISPATCH_SECRET).');
}

const FINISHED = (status: string) => !['pending', 'processing'].includes(status);

// Waits until a job is finished (the 5-minute schedule may pick it up first; the outcome is the same).
export async function finishedJob(id: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { data } = await admin.from('notification_jobs').select('*').eq('id', id).single();
    if (data && FINISHED(data.status)) return data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`job ${id} did not finish`);
}

// Runs the dispatcher until the job is finished. Other due jobs in the local queue may be ahead of
// it in a run's batch, so one call is not always enough.
export async function dispatchUntilFinished(id: string) {
  for (let run = 0; run < 10; run++) {
    await dispatch();
    const { data } = await admin.from('notification_jobs').select('*').eq('id', id).single();
    if (data && FINISHED(data.status)) return data;
  }
  throw new Error(`job ${id} was not finished after 10 dispatcher runs`);
}
