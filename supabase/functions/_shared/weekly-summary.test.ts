import { describe, expect, it } from 'vitest';
import { renderWeeklySummary, weekRange, type SummaryItem } from './weekly-summary.ts';

const base = { officeName: 'Lagos Office', officeTimezone: 'Africa/Lagos', appUrl: 'https://office.example', delayed: false };

function item(overrides: Partial<SummaryItem>): SummaryItem {
  return {
    activity_id: '00000000-0000-4000-8000-000000000a01',
    title: 'Board meeting',
    activity_date: '2026-11-02',
    start_time: '10:00:00',
    end_time: '11:30:00',
    timezone: 'Africa/Lagos',
    starts_at: '2026-11-02T09:00:00Z', // 10:00 in Lagos
    location: 'Board room',
    meeting_url: null,
    preparation_notes: null,
    responsible_name: 'Ada Admin',
    collaborator_names: ['Dele Staff', 'Partner Contact'],
    ...overrides,
  };
}

describe('weekRange', () => {
  it.each([
    ['2026-11-02', '2–8 November 2026'],
    ['2026-11-30', '30 November – 6 December 2026'],
    ['2026-12-28', '28 December 2026 – 3 January 2027'],
  ])('describes the week starting %s as "%s"', (monday, expected) => {
    expect(weekRange(monday)).toBe(expected);
  });
});

describe('renderWeeklySummary', () => {
  const items = [
    item({}),
    item({ activity_id: 'a2', title: 'Report deadline', activity_date: '2026-11-02', start_time: null, end_time: null,
           starts_at: '2026-11-01T23:00:00Z', location: null, collaborator_names: [] }),
    item({ activity_id: 'a3', title: 'London call', activity_date: '2026-11-04', timezone: 'Europe/London',
           start_time: '09:00:00', end_time: null, starts_at: '2026-11-04T09:00:00Z', meeting_url: 'https://meet.example/abc',
           preparation_notes: 'Read the draft\nBring questions' }),
  ];
  const message = renderWeeklySummary({ ...base, periodStart: '2026-11-02', items });

  it('names the office and the week in the subject', () => {
    expect(message.subject).toBe('Lagos Office: the week ahead, 2–8 November 2026');
  });

  it('groups activities by day with times, places and people', () => {
    expect(message.text).toContain('MONDAY 2 NOVEMBER');
    expect(message.text).toContain('- 10:00–11:30: Board meeting');
    expect(message.text).toContain('Responsible: Ada Admin');
    expect(message.text).toContain('With: Dele Staff, Partner Contact');
    expect(message.text).toContain('- All day: Report deadline');
    expect(message.text).toContain('WEDNESDAY 4 NOVEMBER');
    expect(message.html).toContain('<h2 style="font-size:16px;margin:24px 0 8px">Monday 2 November</h2>');
  });

  it('shows a different time zone, and the office time, when an activity is not in office time', () => {
    // 09:00 in London in November (GMT) is 10:00 in Lagos.
    expect(message.text).toContain('- 09:00 (Europe/London time; starts 10:00 Africa/Lagos time): London call');
  });

  it('lists an activity under the office day it starts on', () => {
    // Sunday 8 November 23:30 in London is Monday 9 November 00:30 in Lagos: the first day of that week.
    const late = renderWeeklySummary({
      ...base,
      periodStart: '2026-11-09',
      items: [item({ title: 'Late London call', activity_date: '2026-11-08', timezone: 'Europe/London',
                     start_time: '23:30:00', end_time: null, starts_at: '2026-11-08T23:30:00Z' })],
    });
    expect(late.text).toContain('MONDAY 9 NOVEMBER');
    expect(late.text).not.toContain('SUNDAY 8 NOVEMBER');
    expect(late.text).toContain('- 23:30 (Europe/London time; starts Monday 00:30 Africa/Lagos time): Late London call');
  });

  it('keeps preparation notes and links to each activity and the register', () => {
    expect(message.html).toContain('<em>Preparation:</em> Read the draft<br>Bring questions');
    expect(message.html).toContain('href="https://office.example/activities/00000000-0000-4000-8000-000000000a01"');
    expect(message.text).toContain('https://office.example/activities?from=2026-11-02&to=2026-11-08');
    expect(message.html).toContain('<a href="https://meet.example/abc"');
  });

  it('never lists who receives the summary', () => {
    expect(message.html).not.toMatch(/@/);
    expect(message.text).not.toMatch(/@/);
  });

  it('escapes anything people typed', () => {
    const hostile = renderWeeklySummary({
      ...base,
      periodStart: '2026-11-02',
      items: [item({ title: '<script>alert("x")</script>', location: 'Room "A" & <b>B</b>',
                     meeting_url: 'javascript:alert(1)', responsible_name: '<img src=x>' })],
    });
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).not.toContain('<img');
    expect(hostile.html).not.toContain('javascript:');
    expect(hostile.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(hostile.html).toContain('Room &quot;A&quot; &amp; &lt;b&gt;B&lt;/b&gt;');
  });

  it('says so when nothing is scheduled', () => {
    const empty = renderWeeklySummary({ ...base, periodStart: '2026-11-02', items: [] });
    expect(empty.text).toContain('Nothing is scheduled for this week.');
  });

  it('marks a late summary as delayed', () => {
    const late = renderWeeklySummary({ ...base, delayed: true, periodStart: '2026-11-02', items });
    expect(late.subject).toBe('(Delayed) Lagos Office: the week ahead, 2–8 November 2026');
    expect(late.text).toContain('later than usual');
  });
});
