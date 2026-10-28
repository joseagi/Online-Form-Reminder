import { describe, expect, it } from 'vitest';
import { offeredAction, type JobForAction } from './jobs';

const now = new Date('2026-10-29T10:00:00Z');
const job = (overrides: Partial<JobForAction>): JobForAction => ({
  status: 'pending',
  status_reason: null,
  expires_at: '2026-10-29T12:00:00Z',
  attempt_count: 0,
  ...overrides,
});

describe('offeredAction', () => {
  it('offers to cancel a waiting message', () => {
    expect(offeredAction(job({}), now)).toEqual({ action: 'cancel' });
  });

  it('offers to send a failed message again before its deadline, but not after', () => {
    expect(offeredAction(job({ status: 'failed', status_reason: 'rejected', attempt_count: 1 }), now)).toEqual({ action: 'retry' });
    expect(offeredAction(job({ status: 'failed', expires_at: '2026-10-29T10:00:00Z' }), now)).toBeNull();
    expect(offeredAction(job({ status: 'failed', expires_at: null }), now)).toEqual({ action: 'retry' });
  });

  it('warns before resending a message whose last attempt may have gone out', () => {
    expect(offeredAction(job({ status: 'failed', status_reason: 'outcome_unknown' }), now)?.warning).toMatch(/twice/);
  });

  it('offers to undo an administrator\'s cancel, and nothing for other cancellations', () => {
    expect(offeredAction(job({ status: 'cancelled', status_reason: 'cancelled_by_admin' }), now)).toEqual({ action: 'restore' });
    expect(offeredAction(job({ status: 'cancelled', status_reason: 'activity_cancelled' }), now)).toBeNull();
  });

  it('offers nothing for sent, skipped or in-progress messages, or after 20 attempts', () => {
    for (const status of ['sent', 'skipped', 'processing'] as const) expect(offeredAction(job({ status }), now)).toBeNull();
    expect(offeredAction(job({ status: 'failed', attempt_count: 20 }), now)).toBeNull();
  });
});
