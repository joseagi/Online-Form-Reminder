import { describe, expect, it } from 'vitest';
import { formatTime, formatTimestamp, formatWhen } from './format';

describe('formatTimestamp', () => {
  it('shows the moment in the given time zone', () => {
    // 13:05 UTC is 14:05 in Lagos.
    expect(formatTimestamp('2026-10-21T13:05:00Z', 'Africa/Lagos')).toMatch(/^21 Oct 2026,? 14:05$/);
  });
});

describe('formatWhen', () => {
  it('shows a timed activity with its range', () => {
    expect(formatWhen({ activity_date: '2026-11-03', start_time: '10:00:00', end_time: '11:30:00' })).toMatch(
      /^Tuesday,? 3 November 2026, 10:00–11:30$/,
    );
  });

  it('shows an open-ended start', () => {
    expect(formatWhen({ activity_date: '2026-11-03', start_time: '09:00:00', end_time: null })).toMatch(/, 09:00$/);
  });

  it('shows a date-only activity as all day', () => {
    expect(formatWhen({ activity_date: '2026-12-31', start_time: null, end_time: null })).toMatch(
      /^Thursday,? 31 December 2026 \(all day\)$/,
    );
  });
});

describe('formatTime', () => {
  it('drops seconds', () => {
    expect(formatTime('07:05:00')).toBe('07:05');
    expect(formatTime(null)).toBe('');
  });
});
