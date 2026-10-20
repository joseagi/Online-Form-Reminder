import { describe, expect, it } from 'vitest';
import {
  calendarHref,
  calendarTitle,
  monthGrid,
  parseCalendarParams,
  shiftAnchor,
  startOfWeek,
  weekDays,
} from './calendar';

describe('parseCalendarParams', () => {
  it('defaults to this month for everyone', () => {
    expect(parseCalendarParams({}, '2026-10-21')).toEqual({ view: 'month', anchor: '2026-10-21', mine: false });
  });

  it('reads the week view, a date and "just me"', () => {
    expect(parseCalendarParams({ view: 'week', date: '2026-12-02', mine: '1' }, '2026-10-21')).toEqual({
      view: 'week',
      anchor: '2026-12-02',
      mine: true,
    });
  });

  it('ignores impossible dates', () => {
    expect(parseCalendarParams({ date: '2026-02-30' }, '2026-10-21').anchor).toBe('2026-10-21');
  });
});

describe('weeks start on Monday', () => {
  it.each([
    ['2026-12-02', '2026-11-30'], // Wednesday
    ['2026-11-30', '2026-11-30'], // Monday itself
    ['2026-12-06', '2026-11-30'], // Sunday belongs to the week before
    ['2027-01-01', '2026-12-28'], // across a year end
  ])('the week of %s starts on %s', (date, monday) => {
    expect(startOfWeek(date)).toBe(monday);
  });

  it('weekDays lists Monday to Sunday', () => {
    expect(weekDays('2026-12-02')).toEqual([
      '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06',
    ]);
  });
});

describe('monthGrid', () => {
  it('covers December 2026 with whole weeks', () => {
    const grid = monthGrid('2026-12-15');
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toBe('2026-11-30');
    expect(grid[4][6]).toBe('2027-01-03');
  });

  it('handles a February that fits exactly in four weeks', () => {
    // 1 Feb 2027 is a Monday and February 2027 has 28 days.
    const grid = monthGrid('2027-02-10');
    expect(grid).toHaveLength(4);
    expect(grid[0][0]).toBe('2027-02-01');
    expect(grid[3][6]).toBe('2027-02-28');
  });

  it('handles a month that needs six rows', () => {
    // August 2026 starts on a Saturday and ends on a Monday.
    expect(monthGrid('2026-08-01')).toHaveLength(6);
  });
});

describe('shiftAnchor', () => {
  it('moves by months from the first of the month', () => {
    expect(shiftAnchor('month', '2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftAnchor('month', '2026-03-31', -1)).toBe('2026-02-01');
  });

  it('moves by weeks from the Monday', () => {
    expect(shiftAnchor('week', '2026-12-02', 1)).toBe('2026-12-07');
    expect(shiftAnchor('week', '2026-12-02', -1)).toBe('2026-11-23');
  });
});

describe('titles and links', () => {
  it('names a month and a week', () => {
    expect(calendarTitle('month', '2026-12-15')).toBe('December 2026');
    expect(calendarTitle('week', '2026-12-02')).toBe('30 November – 6 December 2026');
  });

  it('builds links that keep the view and "just me"', () => {
    expect(calendarHref({ view: 'week', anchor: '2026-12-02', mine: true }, { anchor: '2026-12-07' })).toBe(
      '/activities/calendar?view=week&date=2026-12-07&mine=1',
    );
  });
});
