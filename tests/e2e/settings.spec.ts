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
  await page.waitForURL(/\/(admin|cleaner|homeowner|owner)(?:\/|\?|$)/, { timeout: 30_000 });
}

// Legacy-route retirement (cutover runbook Phase 4, 4e): with the redesign
// active (always true on previews, where E2E runs), every legacy
// dashboard/settings URL 307s into its top-level redesign replacement (the /app
// prefix was removed in 4e). These specs pin that contract.
test.describe('Legacy routes redirect into the redesign', () => {
  test('legacy /settings and its sections land on redesign Settings', async ({ page }) => {
    await signIn(page);

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/settings/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/settings/);

    await page.goto('/settings/cancellation-policy', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/settings/);
  });

  test('legacy admin dashboard tab deep-links map to redesign routes', async ({ page }) => {
    await signIn(page);

    await page.goto('/admin-dashboard?tab=payments', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin\/payments/, { timeout: 10_000 });

    await page.goto('/admin-dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  });
});

// Regression: Next 16's client router silently no-ops a same-pathname
// router.replace with different search params after a hard load whose URL
// already carried params (the cached static entry restores its canonical URL).
// Same-path search updates therefore go through native history.replaceState
// (src/lib/shallowSearch.ts). These specs pin the user-visible contract: after
// a reload WITH params in the URL, in-page section/tab switches still work.
test.describe('Search-param navigation survives a hard load with params', () => {
  test('settings section switch works after reloading on a section', async ({ page }) => {
    await signIn(page);

    // Hard load directly onto a non-default section: ?section= in the initial URL.
    await page.goto('/admin/settings?section=branding', { waitUntil: 'domcontentloaded' });
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav).toBeVisible({ timeout: 20_000 });

    await nav.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page).toHaveURL(/section=profile/, { timeout: 10_000 });
    await expect(nav.getByRole('button', { name: 'Profile', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await nav.getByRole('button', { name: 'Payments', exact: true }).click();
    await expect(page).toHaveURL(/section=payments/);
  });

  test('payments ledger tab switch works after reloading on the payouts ledger', async ({ page }) => {
    await signIn(page);

    await page.goto('/admin/payments?ledger=payouts', { waitUntil: 'domcontentloaded' });
    const payoutsTab = page.getByRole('tab', { name: /payouts/i });
    await expect(payoutsTab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });

    await page.getByRole('tab', { name: /transactions/i }).click();
    await expect(page.getByRole('tab', { name: /transactions/i })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 10_000 },
    );
    await expect(page).not.toHaveURL(/ledger=payouts/);
  });
});
