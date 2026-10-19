import { expect, test, type Page } from '@playwright/test';
import { createUser, emailLinkFor, uniqueEmail } from './support';

// Form messages. (Scoped to the form: Next.js also renders an empty role="alert" route announcer.)
const formAlert = (page: Page) => page.locator('form').getByRole('alert');
const formStatus = (page: Page) => page.locator('form').getByRole('status');

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
}

async function chooseNewPassword(page: Page, password: string) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Your password has been saved.')).toBeVisible();
}

const adminUser = { email: uniqueEmail('admin'), password: 'admin-pass-2026', fullName: 'Amaka Admin' };

test.beforeAll(async () => {
  await createUser({ ...adminUser, role: 'admin' });
});

test('signed-out visitors are sent to sign in, then returned to the page they asked for', async ({ page }) => {
  await page.goto('/admin/staff');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fstaff$/);

  await signIn(page, adminUser.email, adminUser.password);
  await expect(page).toHaveURL(/\/admin\/staff$/);
  await expect(page.getByTestId('signed-in-as')).toHaveText(adminUser.fullName);
});

test('a wrong password gets a message that does not reveal whether the account exists', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, adminUser.email, 'wrong-password-1');
  await expect(formAlert(page)).toHaveText('That email and password combination was not recognised.');

  await signIn(page, uniqueEmail('nobody'), 'wrong-password-1');
  await expect(formAlert(page)).toHaveText('That email and password combination was not recognised.');
});

test('a sign-in link cannot send the user to another website', async ({ page }) => {
  await page.goto('/login?next=//evil.example/steal');
  await signIn(page, adminUser.email, adminUser.password);
  await expect(page).toHaveURL('http://localhost:3000/');
});

test('deactivated staff cannot sign in', async ({ page }) => {
  const former = { email: uniqueEmail('former'), password: 'former-pass-2026', fullName: 'Ifeoma Former' };
  await createUser({ ...former, active: false });

  await page.goto('/login');
  await signIn(page, former.email, former.password);
  await expect(formAlert(page)).toHaveText('This account is not active. Please contact an administrator.');
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('an admin invites a colleague, who accepts by email, chooses a password and works as staff', async ({ page }) => {
  const invitee = { email: uniqueEmail('invitee'), password: 'tunde-pass-2026', fullName: 'Tunde Staff' };

  await page.goto('/login?next=/admin/staff');
  await signIn(page, adminUser.email, adminUser.password);
  await page.getByLabel('Full name', { exact: true }).fill(invitee.fullName);
  await page.getByLabel('Work email', { exact: true }).fill(invitee.email);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(formStatus(page)).toHaveText(`Invitation sent to ${invitee.email}.`);
  await expect(page.getByRole('cell', { name: invitee.email })).toBeVisible();
  await signOut(page);

  await page.goto(await emailLinkFor(invitee.email));
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page).toHaveURL(/\/account\/set-password$/);
  await chooseNewPassword(page, invitee.password);
  await expect(page.getByTestId('signed-in-as')).toHaveText(invitee.fullName);
  await expect(page.getByText('You are signed in as a staff member')).toBeVisible();

  // Staff see "not found" on admin pages, and no admin content at all.
  await page.goto('/admin/staff');
  await expect(page.getByText('This page could not be found.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Staff' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);

  // The new password works for a fresh sign-in.
  await page.goto('/');
  await signOut(page);
  await signIn(page, invitee.email, invitee.password);
  await expect(page.getByTestId('signed-in-as')).toHaveText(invitee.fullName);
});

test('a forgotten password can be reset from an emailed link', async ({ page }) => {
  const person = { email: uniqueEmail('reset'), password: 'old-pass-2026', fullName: 'Sade Staff' };
  await createUser(person);

  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(person.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(formStatus(page)).toContainText('If that email belongs to an account');

  await page.goto(await emailLinkFor(person.email));
  await page.getByRole('button', { name: 'Continue' }).click();
  await chooseNewPassword(page, 'new-pass-2026');
  await signOut(page);

  await signIn(page, person.email, 'old-pass-2026');
  await expect(formAlert(page)).toHaveText('That email and password combination was not recognised.');
  await signIn(page, person.email, 'new-pass-2026');
  await expect(page.getByTestId('signed-in-as')).toHaveText(person.fullName);
});
