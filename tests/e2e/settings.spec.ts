import { test, expect } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_TEST_USER_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_USER_PASSWORD;

test.skip(
  !E2E_EMAIL || !E2E_PASSWORD,
  'E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD must be set',
);

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"], input[type="email"]').first().fill(E2E_EMAIL!);
  await page.locator('input[name="password"], input[type="password"]').first().fill(E2E_PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 30_000 });
}

test.describe('Settings route family', () => {
  test('navigating /settings persists in the URL across reloads', async ({ page }) => {
    await signIn(page);

    // Go to /settings — admin should redirect to /settings/payments (default).
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/settings\/(payments|profile|payouts)/, {
      timeout: 10_000,
    });

    // Navigate explicitly to /settings/profile and reload — should stay there.
    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /^profile$/i })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByRole('heading', { name: /^profile$/i })).toBeVisible();
  });

  test('legacy ?tab=settings dashboard URL 307-redirects to /settings/*', async ({ page }) => {
    await signIn(page);

    // Legacy URL with section param → /settings/payments
    await page.goto('/admin-dashboard?tab=settings&section=payments');
    await expect(page).toHaveURL(/\/settings\/payments$/, { timeout: 5_000 });

    // Legacy URL without section param → /settings (which then redirects per role)
    await page.goto('/admin-dashboard?tab=settings');
    await expect(page).toHaveURL(/\/settings(\/|$)/, { timeout: 5_000 });
  });

  test('cancellation policy has its own page, not nested in payments', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings/cancellation-policy');
    await expect(page.getByRole('heading', { name: /cancellation policy/i })).toBeVisible();
    // The policy fields render
    await expect(page.getByLabel(/cancellation window/i)).toBeVisible();
  });
});
