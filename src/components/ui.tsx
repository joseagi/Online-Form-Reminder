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

const controlStyles =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300 aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-700';

type FieldExtras = { label: string; hint?: string; error?: string };

// Label, hint and error wiring shared by every form control. Ids are unique per control:
// Next.js keeps recently visited pages mounted (hidden), so ids derived from field names would
// collide across forms and confuse label associations.
function useFieldIds(explicitId?: string) {
  const generated = useId();
  const id = explicitId ?? generated;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

function describedBy(ids: ReturnType<typeof useFieldIds>, hint?: string, error?: string) {
  return [hint && ids.hintId, error && ids.errorId].filter(Boolean).join(' ') || undefined;
}

function FieldFooter({ ids, hint, error }: { ids: ReturnType<typeof useFieldIds>; hint?: string; error?: string }) {
  return (
    <>
      {hint && (
        <p id={ids.hintId} className="text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={ids.errorId} className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </>
  );
}

export function Field({ label, hint, error, ...input }: FieldExtras & ComponentProps<'input'>) {
  const ids = useFieldIds(input.id);
  return (
    <div className="space-y-1">
      <label htmlFor={ids.id} className="block text-sm font-medium">
        {label}
      </label>
      {/* Password managers and autofill tools often add attributes (e.g. fdprocessedid) to form
          controls before React loads; don't report those as hydration mismatches. */}
      <input
        suppressHydrationWarning
        className={controlStyles}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...input}
        id={ids.id}
      />
      <FieldFooter ids={ids} hint={hint} error={error} />
    </div>
  );
}

export function TextAreaField({ label, hint, error, ...textarea }: FieldExtras & ComponentProps<'textarea'>) {
  const ids = useFieldIds(textarea.id);
  return (
    <div className="space-y-1">
      <label htmlFor={ids.id} className="block text-sm font-medium">
        {label}
      </label>
      <textarea
        suppressHydrationWarning
        rows={4}
        className={controlStyles}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...textarea}
        id={ids.id}
      />
      <FieldFooter ids={ids} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({ label, hint, error, children, ...select }: FieldExtras & ComponentProps<'select'>) {
  const ids = useFieldIds(select.id);
  return (
    <div className="space-y-1">
      <label htmlFor={ids.id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        suppressHydrationWarning
        className={controlStyles}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        {...select}
        id={ids.id}
      >
        {children}
      </select>
      <FieldFooter ids={ids} hint={hint} error={error} />
    </div>
  );
}

export function CheckboxField({ label, hint, error, ...input }: FieldExtras & Omit<ComponentProps<'input'>, 'type'>) {
  const ids = useFieldIds(input.id);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          suppressHydrationWarning
          type="checkbox"
          className="h-4 w-4 rounded border-zinc-300"
          aria-describedby={describedBy(ids, hint, error)}
          {...input}
          id={ids.id}
        />
        <label htmlFor={ids.id} className="text-sm">
          {label}
        </label>
      </div>
      <FieldFooter ids={ids} hint={hint} error={error} />
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

export const secondaryButtonStyles =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

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
