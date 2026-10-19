import { z } from 'zod';

// Keep in step with supabase/config.toml:
//   minimum_password_length = 10, password_requirements = "letters_digits"
export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(72, 'Use at most 72 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one number.');

const email = z.email('Enter a valid email address.');

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
});

export const emailOnlySchema = z.object({ email });

export const setPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'The two passwords do not match.', path: ['confirm'] });

export const inviteSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the person’s name.').max(120, 'Use at most 120 characters.'),
  email,
});

// The first problem, phrased for the person filling in the form.
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form and try again.';
}
