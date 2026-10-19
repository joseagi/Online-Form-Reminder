import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';

export type CurrentUser = {
  id: string;
  fullName: string;
  email: string;
  role: Database['public']['Enums']['app_role'];
};

// The signed-in staff member, or null. Verifies the session token (getClaims) and requires an
// active staff profile, so deactivated staff are treated as signed out. Reads the request's
// cookies, so call it inside a <Suspense> boundary. Cached for the current request only.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Request time only: checking the token compares its expiry with the current time, which
  // Next.js does not allow while speculatively prerendering (e.g. for prefetches).
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('id', data.claims.sub)
    .eq('is_active', true)
    .maybeSingle();
  if (!profile) return null;

  return { id: profile.id, fullName: profile.full_name, email: profile.email, role: profile.role };
});

// For pages and Server Actions: every one checks access itself instead of trusting proxy.ts.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'admin') notFound();
  return user;
}
