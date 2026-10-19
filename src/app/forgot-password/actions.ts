'use server';

import type { FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { emailOnlySchema, firstIssue } from '@/lib/validation/auth';

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailOnlySchema.safeParse({ email: String(formData.get('email') ?? '').trim() });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  // The email links to /auth/confirm (see supabase/templates/recovery.html).
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error) console.error('Password reset request failed:', error.message);

  // Same answer whether or not the address has an account, so accounts can't be discovered.
  return {
    message: 'If that email belongs to an account, a link to reset the password is on its way. It expires in 1 hour.',
  };
}
