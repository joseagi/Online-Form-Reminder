import { describe, expect, it } from 'vitest';
import { firstIssue, inviteSchema, passwordSchema, setPasswordSchema, signInSchema } from './auth';

describe('passwordSchema (matches supabase/config.toml)', () => {
  it('accepts 10+ characters with a letter and a number', () => {
    expect(passwordSchema.safeParse('lagos-office-2026').success).toBe(true);
  });

  it.each([
    ['too short', 'abc12345', 'Use at least 10 characters.'],
    ['no number', 'onlyletters-here', 'Include at least one number.'],
    ['no letter', '1234567890', 'Include at least one letter.'],
    ['over 72 characters', `a1${'x'.repeat(71)}`, 'Use at most 72 characters.'],
  ])('rejects a password that is %s', (_label, password, message) => {
    const result = passwordSchema.safeParse(password);
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssue(result.error)).toBe(message);
  });
});

describe('setPasswordSchema', () => {
  it('requires the confirmation to match', () => {
    const result = setPasswordSchema.safeParse({ password: 'lagos-office-2026', confirm: 'lagos-office-2027' });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssue(result.error)).toBe('The two passwords do not match.');
  });
});

describe('signInSchema', () => {
  it('rejects an invalid email address', () => {
    const result = signInSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssue(result.error)).toBe('Enter a valid email address.');
  });
});

describe('inviteSchema', () => {
  it('trims the name and requires one', () => {
    expect(inviteSchema.safeParse({ fullName: '  Ada Obi ', email: 'ada@example.com' }).data?.fullName).toBe('Ada Obi');
    expect(inviteSchema.safeParse({ fullName: '   ', email: 'ada@example.com' }).success).toBe(false);
  });
});
