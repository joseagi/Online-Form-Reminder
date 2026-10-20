'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { getSettingsRow } from '@/lib/admin/data';
import { requireAdmin } from '@/lib/auth';
import type { FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

const recipientChange = z.object({
  kind: z.enum(['staff', 'contact']),
  id: z.uuid(),
  receives: z.enum(['true', 'false']),
});

// Adds someone to, or removes them from, the weekly summary list.
export async function setSummaryRecipient(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = recipientChange.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  const supabase = await createClient();
  const table = parsed.data.kind === 'staff' ? 'profiles' : 'contacts';
  const { error } = await supabase
    .from(table)
    .update({ receives_weekly_summary: parsed.data.receives === 'true' })
    .eq('id', parsed.data.id);
  if (error) throw new Error(`Could not update the summary list: ${error.message}`);
  refresh();
}

const mailbox = z.object({
  name: z.string().trim().min(1, 'Enter a name for the mailbox.').max(120, 'Use at most 120 characters.'),
  email: z.email('Enter a valid email address.'),
});

// A shared mailbox (e.g. a team or management inbox) that receives the summary.
export async function addSummaryMailbox(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = mailbox.safeParse({
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? '').trim(),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from('contacts')
    .insert({ full_name: parsed.data.name, email: parsed.data.email, receives_weekly_summary: true });

  if (error?.code === '23505') {
    // Already a contact: make sure they receive it.
    const { error: updateError } = await supabase
      .from('contacts')
      .update({ receives_weekly_summary: true, is_active: true })
      .eq('email', parsed.data.email);
    if (updateError) return { error: `That address is already a contact, and could not be updated: ${updateError.message}` };
  } else if (error) {
    return { error: `The mailbox could not be added: ${error.message}` };
  }

  refresh();
  return { message: `${parsed.data.email} will receive the weekly summary.` };
}

export async function sendTestToMe(): Promise<FormState> {
  const admin = await requireAdmin();
  // The dispatcher would only mark the test as skipped, so say so now instead.
  const settings = await getSettingsRow();
  if (settings.notification_mode === 'off') {
    return { error: 'Notifications are switched off, so a test would not be sent. Choose test mode under Settings first.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('queue_test_notification');
  if (error) return { error: error.code === '22023' ? error.message : `The test could not be queued: ${error.message}` };

  const redirect = settings.notification_mode === 'test' ? settings.test_redirect_email : null;
  const destination = redirect ? `${redirect} (test mode sends everything to the test address)` : admin.email;
  return {
    message: `Test queued for ${destination}. It normally appears on the Notifications page within a minute.`,
  };
}
