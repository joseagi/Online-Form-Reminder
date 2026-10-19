import Link from 'next/link';
import { Suspense } from 'react';
import { signOut } from '@/app/actions';
import { getCurrentUser } from '@/lib/auth';

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="font-semibold">
          Office Activities
        </Link>
        {/* Reads the session, so it streams in behind its own boundary. */}
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <nav className="flex items-center gap-4 text-sm">
      {user.role === 'admin' && (
        <Link href="/admin/staff" className="hover:underline">
          Staff
        </Link>
      )}
      <span className="text-zinc-600 dark:text-zinc-400" data-testid="signed-in-as">
        {user.fullName}
      </span>
      <Link href="/account/set-password" className="hover:underline">
        Change password
      </Link>
      <form action={signOut}>
        <button type="submit" className="hover:underline">
          Sign out
        </button>
      </form>
    </nav>
  );
}
