import { describe, expect, it } from 'vitest';
import { describeChange, type HistoryEntry } from './history';

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: 1,
    occurred_at: '2026-10-21T09:00:00Z',
    actor_name: 'Sade Staff',
    entity: 'activity',
    operation: 'update',
    person_name: null,
    changed_fields: null,
    old_data: null,
    new_data: null,
    ...overrides,
  };
}

describe('describeChange', () => {
  it('describes creating an activity', () => {
    expect(describeChange(entry({ operation: 'insert' }))).toBe('created the activity');
  });

  it('lists edited fields in plain words, ignoring derived ones', () => {
    const change = entry({ changed_fields: ['activity_date', 'ends_at', 'start_time', 'starts_at', 'title'] });
    expect(describeChange(change)).toBe('changed the date, start time and title');
  });

  it('describes cancelling with the reason', () => {
    const change = entry({
      changed_fields: ['status', 'status_changed_at', 'status_changed_by', 'status_reason'],
      old_data: { status: 'scheduled' },
      new_data: { status: 'cancelled', status_reason: 'Host unavailable' },
    });
    expect(describeChange(change)).toBe('cancelled the activity: Host unavailable');
  });

  it('describes completing and reopening', () => {
    expect(describeChange(entry({ changed_fields: ['status'], new_data: { status: 'completed' } }))).toBe('marked it completed');
    expect(
      describeChange(entry({ changed_fields: ['status', 'status_reason'], old_data: { status: 'cancelled' }, new_data: { status: 'scheduled' } })),
    ).toBe('reopened it (it was cancelled)');
  });

  it('describes people being added, removed and changed', () => {
    const person = { entity: 'person', person_name: 'Tunde Staff' };
    expect(describeChange(entry({ ...person, operation: 'insert', new_data: { role: 'collaborator' } }))).toBe(
      'added Tunde Staff as collaborator',
    );
    expect(describeChange(entry({ ...person, operation: 'delete' }))).toBe('removed Tunde Staff');
    expect(
      describeChange(entry({ ...person, changed_fields: ['role'], new_data: { role: 'responsible' } })),
    ).toBe('made Tunde Staff responsible');
    expect(
      describeChange(entry({ ...person, changed_fields: ['notify_email'], new_data: { notify_email: false } })),
    ).toBe('turned email reminders off for Tunde Staff');
  });

  it('skips entries with nothing worth showing', () => {
    expect(describeChange(entry({ changed_fields: ['starts_at', 'ends_at'] }))).toBeNull();
  });
});
