'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import type { FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

const jobId = z.uuid();

// The database functions check the administrator role and the message's state again, and say in
// plain words why something is not possible (e.g. the deadline has passed). On success the page
// refreshes, and the message's new status is the confirmation.
async function run(fn: 'cancel_notification_job' | 'retry_notification_job', formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = jobId.safeParse(formData.get('jobId'));
  if (!parsed.success) return { error: 'That message could not be found.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_job_id: parsed.data });
  if (error) {
    if (['22023', 'P0002', '42501'].includes(error.code)) return { error: `${error.message}.` };
    console.error(`${fn} failed:`, error);
    return { error: 'That did not work. Please reload the page and try again.' };
  }
  refresh();
  return {};
}

export async function cancelNotification(_prev: FormState, formData: FormData): Promise<FormState> {
  return run('cancel_notification_job', formData);
}

export async function retryNotification(_prev: FormState, formData: FormData): Promise<FormState> {
  return run('retry_notification_job', formData);
}
