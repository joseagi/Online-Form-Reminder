import { describe, expect, it } from 'vitest';
import { addDays, filtersToQuery, parseFilters, todayIn } from './filters';

const TODAY = '2026-10-21';

describe('parseFilters', () => {
  it('defaults to upcoming activities for anyone, soonest first', () => {
    expect(parseFilters({}, TODAY)).toEqual({
      q: '', from: TODAY, to: '', status: 'all', person: '', order: 'asc', page: 1,
    });
  });

  it('treats an empty "from" as no lower bound (a cleared date field)', () => {
    expect(parseFilters({ from: '' }, TODAY).from).toBe('');
  });

  it('reads valid values', () => {
    const filters = parseFilters(
      { q: '  budget ', from: '2026-11-01', to: '2026-11-30', status: 'cancelled', person: 'me', order: 'desc', page: '3' },
      TODAY,
    );
    expect(filters).toEqual({
      q: 'budget', from: '2026-11-01', to: '2026-11-30', status: 'cancelled', person: 'me', order: 'desc', page: 3,
    });
  });

  it('ignores malformed values instead of failing', () => {
    const filters = parseFilters(
      { from: 'yesterday', to: '31/12/2026', status: 'deleted', person: 'robert;drop', page: '-4' },
      TODAY,
    );
    expect(filters).toMatchObject({ from: '', to: '', status: 'all', person: '', page: 1 });
  });

  it('accepts a staff id as the person', () => {
    const id = '00000000-0000-4000-8000-0000000000f2';
    expect(parseFilters({ person: id }, TODAY).person).toBe(id);
  });

  it('takes the first value when a parameter repeats', () => {
    expect(parseFilters({ status: ['completed', 'cancelled'] }, TODAY).status).toBe('completed');
  });
});

describe('filtersToQuery', () => {
  it('round-trips through parseFilters', () => {
    const filters = parseFilters({ q: 'board', from: '', to: '2026-12-31', status: 'scheduled', person: 'me', page: '2' }, TODAY);
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(filters))), TODAY)).toEqual(filters);
  });

  it('applies overrides, e.g. for the next page', () => {
    expect(filtersToQuery(parseFilters({}, TODAY), { page: 2 })).toBe(`from=${TODAY}&page=2`);
  });
});

describe('todayIn', () => {
  it('uses the office time zone, not the server’s', () => {
    // 23:30 UTC on 20 Oct is already 21 Oct in Lagos (UTC+1).
    const lateEvening = new Date('2026-10-20T23:30:00Z');
    expect(todayIn('Africa/Lagos', lateEvening)).toBe('2026-10-21');
    expect(todayIn('UTC', lateEvening)).toBe('2026-10-20');
  });
});

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
