// The test-mode safety gate. Real recipients are used only when ALL of these hold:
//   1. an administrator set notification_mode = 'live' (system_settings), and
//   2. the server-only secret NOTIFICATIONS_LIVE is exactly "true" (set only in production), and
//   3. a real email provider is configured.
// Anything else is test mode (or "off", which sends nothing at all).

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
