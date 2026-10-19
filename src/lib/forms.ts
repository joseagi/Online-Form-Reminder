// State returned by form Server Actions to useActionState.
export type FormState = {
  error?: string;
  message?: string;
};

export const emptyFormState: FormState = {};

// A search param may arrive once, repeatedly, or not at all.
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
