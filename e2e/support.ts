import { createClient } from '@supabase/supabase-js';

// Test helpers that act on the LOCAL Supabase stack only.

const MAILPIT_URL = 'http://127.0.0.1:54324';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A unique address per run, because profiles are never deleted.
export function uniqueEmail(label: string) {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function createUser(options: {
  email: string;
  password: string;
  fullName: string;
  role?: 'admin' | 'staff';
  active?: boolean;
}) {
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
