import { test, expect } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_TEST_USER_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_USER_PASSWORD;

test.skip(
  !E2E_EMAIL || !E2E_PASSWORD,
  'E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD must be set (seed an admin in the dev Supabase project first)',
);

test('admin can sign in and land on the admin dashboard', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await page.locator('input[type="email"], input[name="email"]').first().fill(E2E_EMAIL!);
  await page.locator('input[type="password"], input[name="password"]').first().fill(E2E_PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // After successful sign-in the admin role should land on /admin-dashboard.
  await page.waitForURL(/\/admin-dashboard/, { timeout: 15_000 });
  // A sanity check that the dashboard rendered.
  await expect(page.getByText(/bookings|appointments|dashboard/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
