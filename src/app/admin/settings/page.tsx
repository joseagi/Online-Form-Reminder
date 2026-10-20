import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminTabs } from '@/app/admin/admin-tabs';
import { requireAdmin } from '@/lib/auth';
import { getSettingsRow } from '@/lib/admin/data';
import { toSettingsForm } from '@/lib/admin/settings';
import { SettingsFormView } from './settings-form';

export const metadata: Metadata = { title: 'Settings · Office Activities' };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <SettingsAdmin />
      </Suspense>
    </main>
  );
}

async function SettingsAdmin() {
  await requireAdmin();
  const row = await getSettingsRow();

  return (
    <>
      <AdminTabs current="settings" />
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
      <SettingsFormView initial={toSettingsForm(row)} timezone={row.timezone} />
    </>
  );
}
