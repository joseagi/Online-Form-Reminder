import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { supabaseUrl } from '@/lib/env';

// Supabase client with the SECRET key: bypasses RLS and can manage Auth users. Use only in
// server code that has already checked the caller is an admin (e.g. sending staff invitations).
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing environment variable SUPABASE_SECRET_KEY (server only). See .env.example.');
  }

  return createClient<Database>(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
