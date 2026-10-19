import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it.each([
    ['/', '/'],
    ['/admin/staff', '/admin/staff'],
    ['/activities?week=2026-10-19#today', '/activities?week=2026-10-19#today'],
  ])('keeps the same-site path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ['another website', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash trick', '/\\evil.example'],
    ['a tab trick', '/\t/evil.example'],
    ['a newline trick', '/\n/evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path', 'admin'],
    ['an empty value', ''],
    ['a missing value', undefined],
    ['a non-string', 42],
  ])('falls back to "/" for %s', (_label, input) => {
    expect(safeNextPath(input)).toBe('/');
  });

  it('uses the given fallback', () => {
    expect(safeNextPath('//evil.example', '/login')).toBe('/login');
  });
});
