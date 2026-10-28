import { expect, test } from '@playwright/test';
import { createActivityAs, createUser, setActivityStatusAs, signIn, uniqueEmail, type TestUser } from './support';

const run = Date.now();
let sade: TestUser;
let tunde: TestUser;

test.beforeAll(async () => {
  [sade, tunde] = await Promise.all([
    createUser({ email: uniqueEmail('sade'), password: 'sade-pass-2026', fullName: `Sade ${run}` }),
    createUser({ email: uniqueEmail('tunde'), password: 'tunde-pass-2026', fullName: `Tunde ${run}` }),
  ]);
});

async function newActivity(title: string, date = '2026-12-08') {
  return createActivityAs(sade, { title, activity_date: date, start_time: '10:00' }, [
    { profile_id: sade.id, role: 'responsible' },
    { profile_id: tunde.id, role: 'collaborator' },
  ]);
}

test('editors cancel, reopen and complete an activity, and each change is in the history', async ({ page }) => {
  const id = await newActivity(`Status flow ${run}`);
  await page.goto(`/login?next=/activities/${id}`);
  await signIn(page, sade.email, sade.password);

  // Cancelling needs a reason.
  await page.getByRole('button', { name: 'Cancel activity' }).click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('Give a reason for cancelling the activity.')).toBeVisible();
  await page.getByLabel('Reason for cancelling').fill('Host unavailable');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText('Activity cancelled.')).toBeVisible();
  // The activity's own status (its reminders, listed below, show theirs too).
  await expect(page.getByTestId('activity-status')).toHaveText('Cancelled');
  await expect(page.getByText('Reason for cancelling: Host unavailable')).toBeVisible();

  await page.getByRole('button', { name: 'Reopen activity' }).click();
  await expect(page.getByText('Activity reopened.')).toBeVisible();
  await expect(page.getByTestId('activity-status')).toHaveText('Scheduled');

  await page.getByRole('button', { name: 'Mark as completed' }).click();
  await page.getByLabel('Outcome note (optional)').fill('Agreed next steps');
  await page.getByRole('button', { name: 'Confirm completed' }).click();
  await expect(page.getByText('Activity marked as completed.')).toBeVisible();
  await expect(page.getByText('Note: Agreed next steps')).toBeVisible();

  const history = page.getByTestId('history');
  await expect(history).toContainText('cancelled the activity: Host unavailable');
  await expect(history).toContainText('reopened it (it was cancelled)');
  await expect(history).toContainText('marked it completed: Agreed next steps');
});

test('a status change based on an out-of-date page is refused', async ({ page }) => {
  const id = await newActivity(`Stale status ${run}`);
  await page.goto(`/login?next=/activities/${id}`);
  await signIn(page, sade.email, sade.password);
  await expect(page.getByRole('button', { name: 'Cancel activity' })).toBeVisible();

  // Someone else completes it while this page is open.
  await setActivityStatusAs(sade, id, 'completed');

  await page.getByRole('button', { name: 'Cancel activity' }).click();
  await page.getByLabel('Reason for cancelling').fill('Too late');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByText(/Someone else changed this activity after you opened it/)).toBeVisible();
});

test('collaborators cannot change the status', async ({ page }) => {
  const id = await newActivity(`Collaborator view ${run}`);
  await page.goto(`/login?next=/activities/${id}`);
  await signIn(page, tunde.email, tunde.password);

  await expect(page.getByRole('heading', { name: `Collaborator view ${run}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel activity' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as completed' })).toHaveCount(0);
});

test('the calendar shows activities on their days, by month and by week', async ({ page }) => {
  await newActivity(`Kickoff ${run}`, '2026-12-02');
  const yearEnd = await createActivityAs(sade, { title: `Year end ${run}`, activity_date: '2026-12-31' }, [
    { profile_id: sade.id, role: 'responsible' },
  ]);
  await newActivity(`January planning ${run}`, '2027-01-04');
  await setActivityStatusAs(sade, yearEnd, 'cancelled', 'Office closed');

  // "Just me" (mine=1) keeps other test runs' activities out of view.
  await page.goto(`/login?next=${encodeURIComponent('/activities/calendar?view=month&date=2026-12-01&mine=1')}`);
  await signIn(page, sade.email, sade.password);

  await expect(page.getByRole('heading', { name: 'December 2026' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Just me' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-date="2026-12-02"]')).toContainText(`10:00 Kickoff ${run}`);
  const yearEndChip = page.locator('[data-date="2026-12-31"]').getByRole('link', { name: `All day Year end ${run}` });
  await expect(yearEndChip).toBeVisible();
  await expect(yearEndChip).toHaveClass(/line-through/);
  await expect(page.getByText(`January planning ${run}`)).toHaveCount(0);

  await page.getByRole('link', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'January 2027' })).toBeVisible();
  await expect(page.locator('[data-date="2027-01-04"]')).toContainText(`January planning ${run}`);

  await page.goto('/activities/calendar?view=week&date=2026-12-02&mine=1');
  await expect(page.getByRole('heading', { name: '30 November – 6 December 2026' })).toBeVisible();
  await expect(page.locator('[data-date="2026-12-02"]')).toContainText(`Kickoff ${run}`);
  await expect(page.getByText(`Year end ${run}`)).toHaveCount(0);
});
