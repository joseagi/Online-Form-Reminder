'use server';

import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { isLinkType } from './link-types';

// Exchanges the one-time token from an invite or password-reset email for a session, then
// asks the person to choose a password.
export async function confirmEmailLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const tokenHash = String(formData.get('token_hash') ?? '');
  const type = formData.get('type');
  if (!tokenHash || !isLinkType(type)) return { error: 'This link is incomplete. Please use the link from your email.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return {
      error:
        type === 'invite'
          ? 'This invitation has expired or has already been used. Ask an administrator to send a new one.'
          : 'This reset link has expired or has already been used. Request a new one from the sign-in page.',
    };
  }

  redirect('/account/set-password');
}
