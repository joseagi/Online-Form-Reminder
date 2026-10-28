import { describe, expect, it } from 'vitest';
import { isReservedAddress, resolveGate, routeMessage } from './mode.ts';
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

describe('routeMessage (who receives a message, and whether it is really sent)', () => {
  const live = { action: 'send', mode: 'live' } as const;
  const test = (redirectTo: string | null) => ({ action: 'send', mode: 'test', redirectTo, warning: null }) as const;
  const reminder = { kind: 'day_before_reminder', destination: 'ada@office.dev' };
  const ownTest = { kind: 'test', destination: 'admin@office.dev' };

  it('sends live messages to their recipient', () => {
    expect(routeMessage(live, reminder, true)).toEqual({ to: 'ada@office.dev', via: 'provider', markAsTest: false });
  });

  it('sends test-mode messages only to the test address', () => {
    expect(routeMessage(test('qa@office.dev'), reminder, true)).toEqual({ to: 'qa@office.dev', via: 'provider', markAsTest: true });
  });

  it('only logs test-mode messages when there is no test address (never the real recipient)', () => {
    expect(routeMessage(test(null), reminder, true)).toEqual({ to: 'ada@office.dev', via: 'log', markAsTest: true });
    expect(routeMessage(test(''), reminder, true)).toMatchObject({ via: 'log' });
  });

  it('sends "Send test to me" to the administrator who asked, in test and live mode', () => {
    expect(routeMessage(test('qa@office.dev'), ownTest, true)).toEqual({ to: 'admin@office.dev', via: 'provider', markAsTest: true });
    expect(routeMessage(test(null), ownTest, true)).toEqual({ to: 'admin@office.dev', via: 'provider', markAsTest: true });
    expect(routeMessage(live, ownTest, true)).toEqual({ to: 'admin@office.dev', via: 'provider', markAsTest: true });
  });

  it('only logs when no real provider is configured', () => {
    for (const [gate, job] of [[test('qa@office.dev'), reminder], [test(null), ownTest], [live, reminder]] as const) {
      expect(routeMessage(gate, job, false).via).toBe('log');
    }
  });

  it('never hands an address on a reserved test domain to the provider', () => {
    expect(routeMessage(test('qa@example.com'), reminder, true)).toMatchObject({ to: 'qa@example.com', via: 'log' });
    expect(routeMessage(live, { kind: 'weekly_summary', destination: 'someone@staff.test' }, true)).toMatchObject({ via: 'log' });
    expect(routeMessage(test(null), { kind: 'test', destination: 'admin@office.test' }, true)).toMatchObject({ via: 'log' });
  });
});

describe('isReservedAddress', () => {
  it('recognises the domains reserved for testing (RFC 2606 and 6761), and only those', () => {
    for (const address of ['a@example.com', 'a@EXAMPLE.ORG', 'a@mail.example.net', 'a@office.test', 'a@x.example', 'a@x.invalid', 'a@localhost', 'a@example.com.']) {
      expect(isReservedAddress(address), address).toBe(true);
    }
    for (const address of ['a@gmail.com', 'a@resend.dev', 'a@example.co.uk', 'a@myexample.com', 'a@test.ng', 'a@contest.org']) {
      expect(isReservedAddress(address), address).toBe(false);
    }
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
