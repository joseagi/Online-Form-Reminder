import { expect, test, type Page } from '@playwright/test';
import {
  createActivityAs,
  createUser,
  readSettings,
  signIn,
  uniqueEmail,
  updateSettings,
  type TestUser,
} from './support';

const run = Date.now();
let admin: TestUser;
let staff: TestUser;
let settingsBefore: Record<string, unknown>;

// A far-future Monday that only this run uses (6 Jan 2031 is a Monday).
const date = new Date('2031-01-06T00:00:00Z');
date.setUTCDate(date.getUTCDate() + 14 * (run % 300));
const PREVIEW_WEEK = date.toISOString().slice(0, 10);

test.beforeAll(async () => {
  settingsBefore = await readSettings();
  [admin, staff] = await Promise.all([
    createUser({ email: uniqueEmail('admin'), password: 'admin-pass-2026', fullName: `Admin ${run}`, role: 'admin' }),
    createUser({ email: uniqueEmail('staff'), password: 'staff-pass-2026', fullName: `Staff ${run}` }),
  ]);
});

test.afterAll(async () => {
  await updateSettings(settingsBefore);
});

async function signInAs(page: Page, user: TestUser, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await signIn(page, user.email, user.password);
}

// Exact, so the route announcer ("404: This page could not be found.") does not also match; visible,
// because Next.js keeps earlier pages mounted but hidden.
const notFound = (page: Page) =>
  page.getByText('This page could not be found.', { exact: true }).filter({ visible: true });

test('staff cannot open the admin screens', async ({ page }) => {
  await signInAs(page, staff, '/admin/settings');
  await expect(notFound(page)).toBeVisible();
  for (const path of ['/admin/summary', '/admin/notifications']) {
    await page.goto(path);
    await expect(notFound(page)).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(0);
});

test('an admin changes the summary settings, with validation', async ({ page }) => {
  await signInAs(page, admin, '/admin/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByLabel('Test address').fill('not-an-address');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();

  await page.getByLabel('Test address').fill(`qa-${run}@example.com`);
  await page.getByLabel('Send time on Sunday').fill('18:15');
  await page.getByLabel('Latest it may go out (hours after the send time)').fill('12');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Send time on Sunday')).toHaveValue('18:15');
  await expect(page.getByLabel('Latest it may go out (hours after the send time)')).toHaveValue('12');
  await expect(page.getByLabel('Test address')).toHaveValue(`qa-${run}@example.com`);
});

test('the preview shows the chosen week, rendered by the same template as the real email', async ({ page }) => {
  const title = `Preview check ${run}`;
  await createActivityAs(admin, { title, activity_date: PREVIEW_WEEK, start_time: '09:30', location: 'Hall C' }, [
    { profile_id: admin.id, role: 'responsible' },
  ]);

  await signInAs(page, admin, `/admin/summary?week=${PREVIEW_WEEK}`);
  await expect(page.getByTestId('preview-subject')).toContainText('the week ahead');
  const preview = page.frameLocator('iframe[title="Summary preview"]');
  await expect(preview.getByText(title)).toBeVisible();
  await expect(preview.getByText('Hall C')).toBeVisible();
});

test('an admin manages who receives the summary', async ({ page }) => {
  await signInAs(page, admin, '/admin/summary');

  const staffRow = page.getByTestId('recipients-staff').getByRole('listitem').filter({ hasText: staff.fullName });
  await expect(staffRow).toContainText('Receives it');
  await staffRow.getByRole('button', { name: `Stop sending to ${staff.fullName}` }).click();
  await expect(staffRow).toContainText('Does not receive it');
  await staffRow.getByRole('button', { name: `Start sending to ${staff.fullName}` }).click();
  await expect(staffRow).toContainText('Receives it');

  const mailbox = { name: `Management ${run}`, email: uniqueEmail('mgmt') };
  await page.getByLabel('Mailbox name').fill(mailbox.name);
  await page.getByLabel('Mailbox email').fill(mailbox.email);
  await page.getByRole('button', { name: 'Add mailbox' }).click();
  await expect(page.getByText(`${mailbox.email} will receive the weekly summary.`)).toBeVisible();
  await expect(page.getByTestId('recipients-contact').getByRole('listitem').filter({ hasText: mailbox.email })).toContainText(
    'Receives it',
  );
});

test('"Send test to me" goes out straight away and shows up in the notification log', async ({ page }) => {
  await updateSettings({ notification_mode: 'off' });
  await signInAs(page, admin, '/admin/summary');
  await page.getByRole('button', { name: 'Send test to me' }).click();
  await expect(page.getByText('Notifications are switched off, so a test would not be sent.')).toBeVisible();

  const testAddress = `qa-send-${run}@example.com`;
  await updateSettings({ notification_mode: 'test', test_redirect_email: testAddress });
  await page.reload();
  await page.getByRole('button', { name: 'Send test to me' }).click();
  await expect(page.getByText(`Test queued for ${testAddress} (test mode sends everything to the test address).`)).toBeVisible();

  // The dispatcher is asked to run immediately; allow it a little time. (The "Sent" filter keeps
  // summaries planned for coming Sundays, which head the full list, out of the way.)
  test.setTimeout(90_000);
  await page.goto('/admin/notifications?status=sent');
  const row = page.getByTestId('notification-row').filter({ hasText: admin.email }).filter({ hasText: 'Test message' });
  await expect(async () => {
    await page.reload();
    await expect(row.first()).toContainText('Sent', { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });

  await expect(page.getByTestId('scheduler-health')).toContainText('Last run:');

  await row.first().getByRole('link', { name: /Details/ }).click();
  await expect(page.getByTestId('message-subject')).toContainText('the week ahead');
  await expect(page.getByTestId('notification-events')).toContainText('accepted');
});
