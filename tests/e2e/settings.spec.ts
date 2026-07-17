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

// Legacy-route retirement (cutover runbook Phase 3): with the redesign active
// (always true on previews, where E2E runs), every legacy dashboard/settings
// URL 307s into its /app/* replacement. These specs pin that contract.
test.describe('Legacy routes redirect into the redesign', () => {
  test('legacy /settings and its sections land on redesign Settings', async ({ page }) => {
    await signIn(page);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app\/admin-dashboard\/settings/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app\/admin-dashboard\/settings/);

    await page.goto('/settings/cancellation-policy', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app\/admin-dashboard\/settings/);
  });

  test('legacy admin dashboard tab deep-links map to redesign routes', async ({ page }) => {
    await signIn(page);

    await page.goto('/admin-dashboard?tab=payments', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app\/admin-dashboard\/payments/, { timeout: 10_000 });

    await page.goto('/admin-dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/app\/admin-dashboard(?:\?|$)/);
  });
});
