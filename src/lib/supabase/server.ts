import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { supabasePublishableKey, supabaseUrl } from '@/lib/env';

// Supabase client acting as the signed-in user (RLS applies). Create one per request: it reads
// the session from this request's cookies.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes the session on every
          // request, and Server Actions (where writing works) take this path without throwing.
        }
      },
    },
  });
}
