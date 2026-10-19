'use server';

import { refresh } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import type { FormState } from '@/lib/forms';
import { createAdminClient } from '@/lib/supabase/admin';
import { firstIssue, inviteSchema } from '@/lib/validation/auth';

// Sends an invitation email. Accepting it creates the person's login and (through a database
// trigger) a staff profile; they then choose their own password.
export async function inviteStaff(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();

  const parsed = inviteSchema.safeParse({
    fullName: String(formData.get('fullName') ?? ''),
    email: String(formData.get('email') ?? '').trim(),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { fullName, email } = parsed.data;
  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });
  if (error) {
    return {
      error:
        error.code === 'email_exists'
          ? 'Someone with that email already has an account.'
          : `The invitation could not be sent: ${error.message}`,
    };
  }

  refresh();
  return { message: `Invitation sent to ${email}.` };
}
