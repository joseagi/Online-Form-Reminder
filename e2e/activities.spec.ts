import { expect, test } from '@playwright/test';
import { createActivityAs, createUser, signIn, uniqueEmail, type TestUser } from './support';

// Unique names per run: earlier runs leave their users in the local database.
const run = Date.now();
let sade: TestUser;
let tunde: TestUser;
let uche: TestUser;

test.beforeAll(async () => {
  [sade, tunde, uche] = await Promise.all([
    createUser({ email: uniqueEmail('sade'), password: 'sade-pass-2026', fullName: `Sade ${run}` }),
    createUser({ email: uniqueEmail('tunde'), password: 'tunde-pass-2026', fullName: `Tunde ${run}` }),
    createUser({ email: uniqueEmail('uche'), password: 'uche-pass-2026', fullName: `Uche ${run}` }),
  ]);
});

test('staff create an activity with a colleague and a new outside contact', async ({ page }) => {
  const title = `Budget review ${run}`;
  const outsider = { name: `Chidi Partner ${run}`, email: uniqueEmail('chidi') };

  await page.goto('/login?next=/activities/new');
  await signIn(page, sade.email, sade.password);
  await expect(page).toHaveURL(/\/activities\/new$/);

  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Date', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Start time').fill('10:00');
  await page.getByLabel('End time').fill('11:30');
  await page.getByLabel('Location', { exact: true }).fill('Board room');
  await page.getByLabel('Preparation notes').fill('Bring the Q3 figures.');

  await page.getByLabel('Add a staff member').selectOption({ label: tunde.fullName });
  await page.getByRole('button', { name: 'Add staff member' }).click();

  // Scoped to the section: the sign-in page stays mounted (hidden) and has an "Email" field too.
  const addOutsider = page.getByRole('group', { name: 'Add someone from outside the office' });
  await addOutsider.getByLabel('Name', { exact: true }).fill(outsider.name);
  await addOutsider.getByLabel('Email', { exact: true }).fill(outsider.email);
  await addOutsider.getByRole('button', { name: 'Add person' }).click();
  await page.getByLabel(`Role for ${outsider.name}`).selectOption('notify_only');

  await page.getByRole('button', { name: 'Create activity' }).click();

  await expect(page).toHaveURL(/\/activities\/[0-9a-f-]{36}\?notice=saved$/);
  await expect(page.getByText('Activity saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(/Tuesday,? 3 November 2026, 10:00–11:30/)).toBeVisible();
  await expect(page.getByText('Bring the Q3 figures.')).toBeVisible();

  const person = (name: string) => page.getByTestId('people').getByRole('listitem').filter({ hasText: name });
  await expect(person(sade.fullName)).toContainText('Responsible');
  await expect(person(tunde.fullName)).toContainText('Collaborator');
  await expect(person(outsider.name)).toContainText('Notify only');
});

test('mistakes are explained before anything is saved, and typed details are kept', async ({ page }) => {
  await page.goto('/login?next=/activities/new');
  await signIn(page, sade.email, sade.password);

  await page.getByLabel('Title', { exact: true }).fill('Back-to-front meeting');
  await page.getByLabel('Date', { exact: true }).fill('2026-11-05');
  await page.getByLabel('Start time').fill('11:00');
  await page.getByLabel('End time').fill('10:00');
  await page.getByRole('button', { name: `Remove ${sade.fullName}` }).click();
  await page.getByRole('button', { name: 'Create activity' }).click();

  await expect(page.getByText('The end time must be after the start time.')).toBeVisible();
  await expect(page.getByText('Choose exactly one responsible person.')).toBeVisible();
  await expect(page).toHaveURL(/\/activities\/new$/);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Back-to-front meeting');
});

test('an edit based on an old version is refused without losing what was typed', async ({ page, context }) => {
  const id = await createActivityAs(
    sade,
    { title: `Conflict test ${run}`, activity_date: '2026-11-10', start_time: '09:00' },
    [{ profile_id: sade.id, role: 'responsible' }],
  );

  await page.goto(`/login?next=/activities/${id}/edit`);
  await signIn(page, sade.email, sade.password);
  await expect(page.getByRole('heading', { name: 'Edit activity' })).toBeVisible();

  // A second tab (the same person, or a colleague) saves first.
  const otherTab = await context.newPage();
  await otherTab.goto(`/activities/${id}/edit`);
  await otherTab.getByLabel('Title', { exact: true }).fill(`Saved first ${run}`);
  await otherTab.getByRole('button', { name: 'Save changes' }).click();
  await expect(otherTab.getByText('Activity saved.')).toBeVisible();

  await page.getByLabel('Title', { exact: true }).fill(`Saved second ${run}`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Someone else changed this activity after you opened it/)).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(`Saved second ${run}`);

  await page.goto(`/activities/${id}`);
  await expect(page.getByRole('heading', { name: `Saved first ${run}` })).toBeVisible();
});

test('collaborators can view but not edit; restricted activities stay hidden', async ({ page }) => {
  const shared = await createActivityAs(
    sade,
    { title: `Shared plan ${run}`, activity_date: '2026-11-12', start_time: '14:00' },
    [{ profile_id: sade.id, role: 'responsible' }, { profile_id: tunde.id, role: 'collaborator' }],
  );
  const restricted = await createActivityAs(
    sade,
    { title: `Private review ${run}`, activity_date: '2026-11-13', visibility: 'restricted' },
    [{ profile_id: sade.id, role: 'responsible' }, { profile_id: uche.id, role: 'notify_only' }],
  );

  await page.goto(`/login?next=/activities/${shared}`);
  await signIn(page, tunde.email, tunde.password);
  await expect(page.getByRole('heading', { name: `Shared plan ${run}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);

  await page.goto(`/activities/${shared}/edit`);
  await expect(page.getByText('This page could not be found.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

  await page.goto(`/activities/${restricted}`);
  await expect(page.getByText('This page could not be found.')).toBeVisible();
  await expect(page.getByText(`Private review ${run}`)).toHaveCount(0);
});
