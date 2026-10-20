import Link from 'next/link';

const TABS = [
  { key: 'settings', href: '/admin/settings', label: 'Settings' },
  { key: 'summary', href: '/admin/summary', label: 'Weekly summary' },
  { key: 'notifications', href: '/admin/notifications', label: 'Notifications' },
  { key: 'staff', href: '/admin/staff', label: 'Staff' },
] as const;

// Rendered only after the admin check, so non-admins never see the admin navigation.
export function AdminTabs({ current }: { current: (typeof TABS)[number]['key'] }) {
  return (
    <nav aria-label="Administration" className="mb-8 flex flex-wrap gap-2 border-b border-zinc-200 pb-3 text-sm dark:border-zinc-800">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? 'page' : undefined}
          className={`rounded-md px-3 py-1.5 ${
            tab.key === current
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
