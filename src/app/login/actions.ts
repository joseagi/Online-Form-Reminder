'use server';

import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/forms';
import { safeNextPath } from '@/lib/safe-redirect';
import { createClient } from '@/lib/supabase/server';
import { firstIssue, signInSchema } from '@/lib/validation/auth';

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  // Same message for an unknown email and a wrong password, so accounts can't be discovered.
  if (error || !data.user) return { error: 'That email and password combination was not recognised.' };

  // A valid password is not enough: the person must still have an active staff profile.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', data.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return { error: 'This account is not active. Please contact an administrator.' };
  }

  redirect(safeNextPath(formData.get('next')));
}
