'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import type { FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { firstIssue, setPasswordSchema } from '@/lib/validation/auth';

export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser();

  const parsed = setPasswordSchema.safeParse({
    password: String(formData.get('password') ?? ''),
    confirm: String(formData.get('confirm') ?? ''),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      error:
        error.code === 'same_password'
          ? 'Choose a password that is different from your current one.'
          : 'The password could not be saved. Please try again.',
    };
  }

  redirect('/?notice=password-set');
}
