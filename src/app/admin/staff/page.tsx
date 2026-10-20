import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminTabs } from '@/app/admin/admin-tabs';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { InviteForm } from './invite-form';

export const metadata: Metadata = { title: 'Staff · Office Activities' };

export default function StaffPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      {/* Everything, including the heading, waits for the admin check. */}
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <StaffAdmin />
      </Suspense>
    </main>
  );
}

async function StaffAdmin() {
  await requireAdmin();

  // Read as the signed-in admin, so RLS still applies.
  const supabase = await createClient();
  const { data: staff, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .order('full_name');
  if (error) throw new Error(`Could not load staff: ${error.message}`);

  return (
    <div className="space-y-10">
      <AdminTabs current="staff" />
      <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
      <section>
        <h2 className="mb-3 text-lg font-medium">Invite a staff member</h2>
        <InviteForm />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">People ({staff.length})</h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((person) => (
              <tr key={person.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4">{person.full_name}</td>
                <td className="py-2 pr-4">{person.email}</td>
                <td className="py-2 pr-4">{person.role === 'admin' ? 'Admin' : 'Staff'}</td>
                <td className="py-2">{person.is_active ? 'Active' : 'Deactivated'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-zinc-500">Changing roles and deactivating staff arrives with the admin screens in Phase 3.</p>
      </section>
    </div>
  );
}
