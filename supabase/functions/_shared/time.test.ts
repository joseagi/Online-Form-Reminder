import { describe, expect, it } from 'vitest';
import { localDate, localTime, zoneNote } from './time.ts';

// Europe/London: GMT (UTC+0) in winter, BST (UTC+1) from 01:00 UTC on 29 March 2026 to 01:00 UTC
// on 25 October 2026. Africa/Lagos: UTC+1 all year.
describe('localDate / localTime across clock changes', () => {
  it.each([
    ['2026-03-29T00:59:00Z', 'Europe/London', '2026-03-29', '00:59'], // last minute of GMT
    ['2026-03-29T01:00:00Z', 'Europe/London', '2026-03-29', '02:00'], // clocks jump to 02:00 BST
    ['2026-10-25T00:30:00Z', 'Europe/London', '2026-10-25', '01:30'], // first 01:30 (BST)
    ['2026-10-25T01:30:00Z', 'Europe/London', '2026-10-25', '01:30'], // second 01:30 (GMT)
    ['2026-11-08T23:30:00Z', 'Africa/Lagos', '2026-11-09', '00:30'], // next day in Lagos
  ])('%s in %s is %s %s', (iso, zone, date, time) => {
    expect(localDate(iso, zone)).toBe(date);
    expect(localTime(iso, zone)).toBe(time);
  });
});

describe('zoneNote', () => {
  const lagos = 'Africa/Lagos';

  it('adds nothing for an activity in office time', () => {
    expect(zoneNote({ timezone: lagos, activityDate: '2026-11-04', startsAt: '2026-11-04T09:00:00Z', officeTimezone: lagos })).toBe('');
  });

  it('gives the office time, which moves with London\'s clock change', () => {
    // 09:00 London in winter (GMT) is 10:00 in Lagos; in summer (BST) it is 09:00.
    expect(zoneNote({ timezone: 'Europe/London', activityDate: '2026-11-04', startsAt: '2026-11-04T09:00:00Z', officeTimezone: lagos }))
      .toBe(' (Europe/London time; starts 10:00 Africa/Lagos time)');
    expect(zoneNote({ timezone: 'Europe/London', activityDate: '2026-06-03', startsAt: '2026-06-03T08:00:00Z', officeTimezone: lagos }))
      .toBe(' (Europe/London time; starts 09:00 Africa/Lagos time)');
  });

  it('names the office day when it differs from the activity\'s', () => {
    // Sunday 23:30 in London (GMT) is Monday 00:30 in Lagos.
    expect(zoneNote({ timezone: 'Europe/London', activityDate: '2026-11-08', startsAt: '2026-11-08T23:30:00Z', officeTimezone: lagos }))
      .toBe(' (Europe/London time; starts Monday 00:30 Africa/Lagos time)');
  });
});
