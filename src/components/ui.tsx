import { useId, type ComponentProps, type ReactNode } from 'react';
import type { FormState } from '@/lib/forms';

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        {children}
      </div>
    </main>
  );
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & ComponentProps<'input'>) {
  // Unique per field: Next.js keeps recently visited pages mounted (hidden), so ids derived from
  // field names would collide across forms and confuse label associations.
  const generatedId = useId();
  const id = input.id ?? generatedId;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {/* Password managers and autofill tools often add attributes (e.g. fdprocessedid) to form
          controls before React loads; don't report those as hydration mismatches. */}
      <input
        suppressHydrationWarning
        id={id}
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-700"
        {...input}
      />
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      suppressHydrationWarning
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {pending ? 'Please wait…' : children}
    </button>
  );
}

const alertStyles = {
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200',
  info: 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300',
} as const;

export function Alert({ tone, children }: { tone: keyof typeof alertStyles; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${alertStyles[tone]}`}>
      {children}
    </p>
  );
}

// Shows the outcome of a form Server Action.
export function FormStatus({ state }: { state: FormState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}
