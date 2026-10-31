import { describe, expect, it } from 'vitest';
import { ALERT_LIST_LIMIT, renderFailureAlert, type AlertItem } from './failure-alert.ts';

const base = { officeName: 'Lagos Office', officeTimezone: 'Africa/Lagos', appUrl: 'https://office.example' };

function item(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    job_id: '00000000-0000-4000-8000-0000000000f1',
    kind: 'day_before_reminder',
    destination: 'bayo@example.com',
    scheduled_for: '2035-03-05T09:00:00Z', // 10:00 in Lagos (UTC+1)
    status: 'failed',
    status_reason: 'rejected',
    delivery_status: 'unknown',
    last_error_code: 'validation_error',
    last_error_message: 'Invalid `to` field.',
    activity_title: 'Board meeting',
    period_start: null,
    ...overrides,
  };
}

describe('renderFailureAlert', () => {
  it('counts the problems in the subject', () => {
    expect(renderFailureAlert({ ...base, items: [item()] }).subject).toBe('Lagos Office: 1 notification needs attention');
    expect(renderFailureAlert({ ...base, items: [item(), item()] }).subject).toBe('Lagos Office: 2 notifications need attention');
  });

  it('says for each message what it was, who it was for, when it was due (office time) and what went wrong', () => {
    const { text, html } = renderFailureAlert({ ...base, items: [item()] });
    expect(text).toContain('- Reminder: Board meeting\n  To bayo@example.com, due 2035-03-05 10:00 (Africa/Lagos)\n  Refused by the email provider (validation_error)');
    expect(html).toContain('<strong>Reminder: Board meeting</strong>');
    expect(html).toContain('Refused by the email provider (validation_error)');
  });

  it('links each message to its page, where it can be sent again', () => {
    const { text, html } = renderFailureAlert({ ...base, items: [item()] });
    expect(text).toContain('https://office.example/admin/notifications/00000000-0000-4000-8000-0000000000f1');
    expect(html).toContain('<a href="https://office.example/admin/notifications/00000000-0000-4000-8000-0000000000f1">');
  });

  it('explains each kind of problem in plain words', () => {
    const lines = (overrides: Partial<AlertItem>) => renderFailureAlert({ ...base, items: [item(overrides)] }).text;
    expect(lines({ status_reason: 'retries_exhausted', last_error_code: 'service_unavailable' })).toContain(
      'Gave up after repeated temporary problems (service_unavailable)',
    );
    expect(lines({ status_reason: 'outcome_unknown', last_error_code: null })).toContain(
      "Unclear whether it was sent: check the email provider's log before sending it again",
    );
    const delivered = { status: 'sent', status_reason: null, last_error_code: null };
    expect(lines({ ...delivered, delivery_status: 'bounced' })).toContain('Bounced: the address could not receive it');
    expect(lines({ ...delivered, delivery_status: 'complained' })).toContain('The recipient marked it as spam');
    expect(lines({ ...delivered, delivery_status: 'suppressed' })).toContain("on the email provider's suppression list");
  });

  it('names summaries and test messages', () => {
    const { text } = renderFailureAlert({
      ...base,
      items: [item({ kind: 'weekly_summary', activity_title: null, period_start: '2035-03-05' }), item({ kind: 'test', activity_title: null })],
    });
    expect(text).toContain('- Weekly summary, week of 2035-03-05');
    expect(text).toContain('- Test message');
  });

  it('escapes what people typed (titles, addresses, error messages)', () => {
    const { html } = renderFailureAlert({ ...base, items: [item({ activity_title: '<script>alert(1)</script>' })] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it(`lists at most ${ALERT_LIST_LIMIT} and points to the log for the rest`, () => {
    const items = Array.from({ length: ALERT_LIST_LIMIT + 3 }, (_, i) => item({ job_id: `job-${i}` }));
    const { subject, text, html } = renderFailureAlert({ ...base, items });
    expect(subject).toBe(`Lagos Office: ${ALERT_LIST_LIMIT + 3} notifications need attention`);
    expect(text.match(/^- /gm)).toHaveLength(ALERT_LIST_LIMIT);
    expect(text).toContain('...and 3 more: https://office.example/admin/notifications?status=failed');
    expect(html).toContain('…and 3 more');
  });

  it('says why the administrator receives it and how often alerts come', () => {
    const { text } = renderFailureAlert({ ...base, items: [item()] });
    expect(text).toContain('You receive this because you are an administrator of the Lagos Office activity register.');
    expect(text).toContain('at most once every 6 hours');
  });
});
