import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DENO_DISPATCHER_URL, startDenoDispatcher } from './deno-dispatcher';
import { startFakeResend } from './fake-resend';
import { admin, dispatchUntilFinished, psql, requireDispatchSecret } from './support';

// The failure alert to administrators (stage 6d), end to end: problems planned into an alert, and
// the alert sent by the real dispatcher code (run with Deno) to a fake Resend.
// The problems and alerts here are dated January 2000 and planned "as of" then (p_now), so the
// local database's own messages and alerts are never involved.

const run = Date.now();
const REDIRECT = 'delivered+alerts@resend.dev'; // Resend's test inbox, in case the stack's own schedule sends one

let fake: Awaited<ReturnType<typeof startFakeResend>>;
let dispatcher: Awaited<ReturnType<typeof startDenoDispatcher>>;
let settingsBefore: Record<string, unknown>;
let officeName: string;
let activeAdmins: number;

// A failed or bounced message from January 2000.
function problemSql(label: string, { bounced = false, changedAt }: { bounced?: boolean; changedAt: string }) {
  const key = `int-alert-${run}-${label}`;
  return bounced
    ? `insert into public.notification_jobs (kind, channel, dedupe_key, destination, period_start, scheduled_for, run_after,
         status, attempt_count, provider, provider_message_id, accepted_at, delivery_status, updated_at)
       values ('weekly_summary', 'email', '${key}', '${label}-${run}@example.com', '2000-01-03', '${changedAt}', '${changedAt}',
         'sent', 1, 'resend', '${key}', '${changedAt}', 'bounced', '${changedAt}');`
    : `insert into public.notification_jobs (kind, channel, dedupe_key, destination, period_start, scheduled_for, run_after,
         status, status_reason, attempt_count, last_error_code, updated_at)
       values ('test', 'email', '${key}', '${label}-${run}@example.com', '2000-01-03', '${changedAt}', '${changedAt}',
         'failed', 'rejected', 1, 'validation_error', '${changedAt}');`;
}

async function alertsBetween(from: string, to: string) {
  const { data, error } = await admin
    .from('notification_jobs')
    .select('id, dedupe_key')
    .eq('kind', 'failure_alert')
    .gte('scheduled_for', from)
    .lt('scheduled_for', to);
  if (error) throw error;
  return data;
}

async function cleanUp() {
  await admin.from('notification_jobs').delete().like('dedupe_key', 'int-alert-%');
  await admin.from('notification_jobs').delete().eq('kind', 'failure_alert').lt('scheduled_for', '2001-01-01');
}

beforeAll(async () => {
  requireDispatchSecret();
  await cleanUp(); // from an earlier run that stopped half-way
  const { data: settings } = await admin.from('system_settings').select('office_name, notification_mode, test_redirect_email').single();
  settingsBefore = { notification_mode: settings!.notification_mode, test_redirect_email: settings!.test_redirect_email };
  officeName = settings!.office_name;
  await admin.from('system_settings').update({ notification_mode: 'test', test_redirect_email: REDIRECT }).eq('id', true);

  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('is_active', true);
  activeAdmins = count ?? 0;
  if (activeAdmins === 0) throw new Error('These tests need an active administrator: run npm run admin:create');

  fake = await startFakeResend();
  dispatcher = await startDenoDispatcher({ RESEND_API_KEY: 're_fake_key', EMAIL_FROM_ADDRESS: 'onboarding@resend.dev', RESEND_API_URL: fake.url });
});

afterAll(async () => {
  await dispatcher?.kill();
  await fake?.close();
  if (settingsBefore) await admin.from('system_settings').update(settingsBefore).eq('id', true);
  await cleanUp();
});

describe('failure alert', () => {
  it('emails each administrator once, listing every problem with a link to it', { timeout: 120_000 }, async () => {
    // Planned as of noon on 1 January 2000, then made due now (in the same transaction, so the
    // stack's own schedule cannot find it in between and skip it as too late).
    await psql(`
      begin;
      ${problemSql('refused', { changedAt: '2000-01-01 10:00+00' })}
      ${problemSql('bounced', { bounced: true, changedAt: '2000-01-01 10:30+00' })}
      select public.plan_failure_alerts('2000-01-01 12:00+00');
      update public.notification_jobs set run_after = now(), expires_at = now() + interval '1 hour'
       where kind = 'failure_alert' and scheduled_for = '2000-01-01 12:00+00';
      commit;`);
    const alerts = await alertsBetween('2000-01-01 12:00+00', '2000-01-01 12:00:01+00');
    expect(alerts).toHaveLength(activeAdmins);

    const { data: problems } = await admin.from('notification_jobs').select('id, dedupe_key').like('dedupe_key', `int-alert-${run}-%`);
    for (const alert of alerts) {
      const job = await dispatchUntilFinished(alert.id, { url: DENO_DISPATCHER_URL });
      expect(job).toMatchObject({ status: 'sent', provider: 'resend', send_mode: 'test' });

      const requests = fake.requestsFor(alert.dedupe_key);
      expect(requests).toHaveLength(1);
      const email = JSON.parse(requests[0].body) as { to: string[]; subject: string; text: string; html: string };
      expect(email.to).toEqual([REDIRECT]); // test mode: to the test address, never a real one
      expect(email.subject).toBe(`[TEST] ${officeName}: 2 notifications need attention`);
      expect(email.text).toContain(`refused-${run}@example.com`);
      expect(email.text).toContain('Refused by the email provider (validation_error)');
      expect(email.text).toContain(`bounced-${run}@example.com`);
      expect(email.text).toContain('Bounced: the address could not receive it');
      for (const problem of problems!) expect(email.text).toContain(`/admin/notifications/${problem.id}`);
    }
  });

  it('two runs planning at the same moment send one alert, not two', { timeout: 60_000 }, async () => {
    await psql(problemSql('race', { changedAt: '2000-01-02 10:00+00' }));

    // Session A plans, then holds its transaction open for 3 seconds. Session B plans a second
    // later: it must wait for A, then see A's alert (and plan none), rather than plan its own.
    const first = psql(`begin; select public.plan_failure_alerts('2000-01-02 12:00+00'); select pg_sleep(3); commit;`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const second = await psql(`select public.plan_failure_alerts('2000-01-02 12:00:01+00');`);
    const a = await first;

    expect(second.output).toBe('0');
    expect(second.finishedAt).toBeGreaterThanOrEqual(a.finishedAt - 100); // it waited for A
    expect(await alertsBetween('2000-01-02 00:00+00', '2000-01-03 00:00+00')).toHaveLength(activeAdmins);
  });
});
