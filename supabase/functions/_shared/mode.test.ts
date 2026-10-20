import { describe, expect, it } from 'vitest';
import { resolveGate } from './mode.ts';
import { constantTimeEqual } from './security.ts';
import { escapeHtml, safeHref } from './html.ts';

describe('resolveGate (test mode cannot accidentally send real notifications)', () => {
  const base = { notificationsLiveEnv: undefined, hasRealProvider: false, testRedirectEmail: null };

  it('sends nothing when notifications are off', () => {
    expect(resolveGate({ ...base, settingsMode: 'off', notificationsLiveEnv: 'true', hasRealProvider: true })).toEqual({
      action: 'skip',
      reason: 'notifications_off',
    });
  });

  it('uses test mode, with the redirect address, when set to test', () => {
    expect(resolveGate({ ...base, settingsMode: 'test', testRedirectEmail: 'qa@example.com' })).toEqual({
      action: 'send', mode: 'test', redirectTo: 'qa@example.com', warning: null,
    });
  });

  it.each([
    ['the server flag is missing', { notificationsLiveEnv: undefined, hasRealProvider: true }],
    ['the server flag is not exactly "true"', { notificationsLiveEnv: 'TRUE', hasRealProvider: true }],
    ['no real provider is configured', { notificationsLiveEnv: 'true', hasRealProvider: false }],
  ])('stays in test mode when live is selected but %s', (_label, overrides) => {
    const gate = resolveGate({ ...base, settingsMode: 'live', ...overrides });
    expect(gate).toMatchObject({ action: 'send', mode: 'test' });
    expect(gate.action === 'send' && gate.mode === 'test' && gate.warning).toBeTruthy();
  });

  it('goes live only when the setting, the server flag and a provider all agree', () => {
    expect(resolveGate({ ...base, settingsMode: 'live', notificationsLiveEnv: 'true', hasRealProvider: true })).toEqual({
      action: 'send',
      mode: 'live',
    });
  });
});

describe('constantTimeEqual', () => {
  it('matches only identical secrets', () => {
    expect(constantTimeEqual('s3cret-value', 's3cret-value')).toBe(true);
    expect(constantTimeEqual('s3cret-value', 's3cret-valuf')).toBe(false);
    expect(constantTimeEqual('s3cret-value', 's3cret')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});

describe('html helpers', () => {
  it('escapes markup and only allows web links', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(safeHref('https://meet.example/x')).toBe('https://meet.example/x');
    expect(safeHref('javascript:alert(1)')).toBeNull();
  });
});
