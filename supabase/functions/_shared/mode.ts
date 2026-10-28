// The test-mode safety gate. Real recipients are used only when ALL of these hold:
//   1. an administrator set notification_mode = 'live' (system_settings), and
//   2. the server-only secret NOTIFICATIONS_LIVE is exactly "true" (set only in production), and
//   3. a real email provider is configured.
// Anything else is test mode (or "off", which sends nothing at all). routeMessage() then decides,
// per message, the address and whether the real provider or only the log is used.

export type SettingsMode = 'off' | 'test' | 'live';

export type Gate =
  | { action: 'skip'; reason: 'notifications_off' }
  | { action: 'send'; mode: 'test'; redirectTo: string | null; warning: string | null }
  | { action: 'send'; mode: 'live' };

export function resolveGate(input: {
  settingsMode: SettingsMode;
  notificationsLiveEnv: string | undefined;
  hasRealProvider: boolean;
  testRedirectEmail: string | null;
}): Gate {
  if (input.settingsMode === 'off') return { action: 'skip', reason: 'notifications_off' };

  if (input.settingsMode === 'live') {
    if (input.notificationsLiveEnv === 'true' && input.hasRealProvider) return { action: 'send', mode: 'live' };
    const warning =
      input.notificationsLiveEnv !== 'true'
        ? 'Live mode was selected, but NOTIFICATIONS_LIVE is not "true" on this server: sending in test mode.'
        : 'Live mode was selected, but no email provider is configured: sending in test mode.';
    return { action: 'send', mode: 'test', redirectTo: input.testRedirectEmail, warning };
  }

  return { action: 'send', mode: 'test', redirectTo: input.testRedirectEmail, warning: null };
}

// Addresses on domains reserved for documentation and testing (RFC 2606, RFC 6761) can never
// receive mail. Messages to them are only logged, so test data never reaches the provider (and
// never bounces against the sender's reputation).
export function isReservedAddress(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(test|example|invalid|localhost)$/.test(domain) || /(^|\.)example\.(com|net|org)$/.test(domain);
}

export type Route = { to: string; via: 'provider' | 'log'; markAsTest: boolean };

// Where one message goes, and whether the real provider sends it.
//   live:  to its recipient.
//   test:  to the test address; without one, it is only logged. Real recipients are never used.
//   "Send test to me" (kind 'test') always goes to the administrator who asked for it.
export function routeMessage(
  gate: Extract<Gate, { action: 'send' }>,
  job: { kind: string; destination: string },
  hasRealProvider: boolean,
): Route {
  const ownTest = job.kind === 'test';
  const redirect = gate.mode === 'test' ? gate.redirectTo : null;
  const to = gate.mode === 'live' || ownTest ? job.destination : redirect || job.destination;
  const deliverable = gate.mode === 'live' || ownTest || Boolean(redirect);
  return {
    to,
    via: hasRealProvider && deliverable && !isReservedAddress(to) ? 'provider' : 'log',
    markAsTest: gate.mode === 'test' || ownTest,
  };
}
