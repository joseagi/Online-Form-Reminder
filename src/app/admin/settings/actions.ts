'use server';

import { refresh } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { settingsSchema, toSettingsUpdate, type SettingsForm } from '@/lib/admin/settings';
import { issuesByPath } from '@/lib/activities/schema';
import { createClient } from '@/lib/supabase/server';

export type SettingsState = { error?: string; message?: string; fieldErrors?: Record<string, string> };

export async function saveSettings(_prev: SettingsState, input: SettingsForm): Promise<SettingsState> {
  await requireAdmin();

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: 'Please correct the highlighted settings.', fieldErrors: issuesByPath(parsed.error) };

  // Written as the signed-in administrator: RLS allows it, and the audit trail records who did it.
  const supabase = await createClient();
  const { error } = await supabase.from('system_settings').update(toSettingsUpdate(parsed.data)).eq('id', true);
  if (error) {
    console.error('Saving settings failed:', error);
    return { error: 'The settings could not be saved. Please check them and try again.' };
  }

  refresh();
  return { message: 'Settings saved.' };
}
