import { expect, test, type Page } from '@playwright/test';
import { createActivityAs, createUser, setActivityStatusAs, signIn, uniqueEmail, type TestUser } from './support';

// Every activity here carries a unique search word, so earlier runs' data never interferes.
// Dates are fixed and searches use from= (all dates), so the tests don't depend on today's date.
const run = Date.now();
const tag = `zq${run}`;
let sade: TestUser;
let tunde: TestUser;
let uche: TestUser;

const rows = (page: Page) => page.getByTestId('activity-row');

test.beforeAll(async () => {
  [sade, tunde, uche] = await Promise.all([
    createUser({ email: uniqueEmail('sade'), password: 'sade-pass-2026', fullName: `Sade ${run}` }),
    createUser({ email: uniqueEmail('tunde'), password: 'tunde-pass-2026', fullName: `Tunde ${run}` }),
    createUser({ email: uniqueEmail('uche'), password: 'uche-pass-2026', fullName: `Uche ${run}` }),
  ]);

  const sadeOnly = [{ profile_id: sade.id, role: 'responsible' }];
  await createActivityAs(
    sade,
    { title: `Kickoff ${tag}`, activity_date: '2026-12-02', start_time: '10:00', location: 'Hall A' },
    [...sadeOnly, { profile_id: tunde.id, role: 'collaborator' }],
  );
  await createActivityAs(sade, { title: `Review ${tag}`, activity_date: '2026-12-01' }, sadeOnly);
  const offsite = await createActivityAs(sade, { title: `Offsite ${tag}`, activity_date: '2026-12-03', start_time: '09:00' }, sadeOnly);
  await setActivityStatusAs(sade, offsite, 'cancelled', 'Venue unavailable');
  await createActivityAs(sade, { title: `Private ${tag}`, activity_date: '2026-12-04', visibility: 'restricted' }, sadeOnly);
});

test('the register lists matching activities in date order, and filters narrow them', async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent(`/activities?q=${tag}&from=`)}`);
  await signIn(page, sade.email, sade.password);

  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).nth(0)).toContainText(`Review ${tag}`);
  await expect(rows(page).nth(0)).toContainText('All day');
  await expect(rows(page).nth(1)).toContainText(`Kickoff ${tag}`);
  await expect(rows(page).nth(1)).toContainText(`Responsible: ${sade.fullName}`);
  await expect(rows(page).nth(2)).toContainText(`Offsite ${tag}`);
  await expect(rows(page).nth(2)).toContainText('Cancelled');
  await expect(rows(page).nth(3)).toContainText('Restricted');

  // Filter by status using the form.
  await page.getByLabel('Status').selectOption('cancelled');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/status=cancelled/);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(`Offsite ${tag}`);

  // Filter by person through the URL (a bookmarked view).
  await page.goto(`/activities?q=${tag}&from=&person=${tunde.id}`);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(`Kickoff ${tag}`);

  // A date range.
  await page.goto(`/activities?q=${tag}&from=2026-12-02&to=2026-12-03`);
  await expect(rows(page)).toHaveCount(2);
});

test('restricted activities never appear for uninvolved staff', async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent(`/activities?q=${tag}&from=`)}`);
  await signIn(page, uche.email, uche.password);

  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByText(`Private ${tag}`)).toHaveCount(0);
});

test('the detail page shows who changed what', async ({ page }) => {
  const id = await createActivityAs(
    sade,
    { title: `History ${tag}`, activity_date: '2026-12-10', start_time: '15:00' },
    [{ profile_id: sade.id, role: 'responsible' }],
  );

  await page.goto(`/login?next=/activities/${id}/edit`);
  await signIn(page, sade.email, sade.password);
  await page.getByLabel('Title', { exact: true }).fill(`History renamed ${tag}`);
  await page.getByLabel('Add a staff member').selectOption({ label: tunde.fullName });
  await page.getByRole('button', { name: 'Add staff member' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Activity saved.')).toBeVisible();

  await setActivityStatusAs(sade, id, 'cancelled', 'Host unavailable');
  await page.reload();

  const history = page.getByTestId('history');
  await expect(history).toContainText(`${sade.fullName} created the activity`);
  await expect(history).toContainText(`${sade.fullName} changed the title`);
  await expect(history).toContainText(`${sade.fullName} added ${tunde.fullName} as collaborator`);
  await expect(history).toContainText(`${sade.fullName} cancelled the activity: Host unavailable`);
  // Newest first.
  await expect(history.getByRole('listitem').first()).toContainText('cancelled the activity');
});
