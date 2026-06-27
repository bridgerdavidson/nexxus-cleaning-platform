/**
 * E2E smoke test: Cleaner App Slice 3 - active-job overview
 *
 * Phone-viewport (375px) test against the redesign cleaner shell.
 * Resilient by design: if no in_progress job exists in the seed DB,
 * the test skips cleanly rather than failing.
 *
 * Env vars required (same as auth.spec.ts / settings.spec.ts):
 *   E2E_CLEANER_EMAIL     - a cleaner role account in the preview DB
 *   E2E_CLEANER_PASSWORD
 *
 * Falls back to E2E_TEST_USER_EMAIL/E2E_TEST_USER_PASSWORD only if the
 * cleaner-specific vars are absent (the signed-in user must be role=cleaner
 * for /app/cleaner-dashboard to be accessible; if it is not, the test skips).
 */

import { test, expect } from '@playwright/test';

const CLEANER_EMAIL =
  process.env.E2E_CLEANER_EMAIL ?? process.env.E2E_TEST_USER_EMAIL;
const CLEANER_PASSWORD =
  process.env.E2E_CLEANER_PASSWORD ?? process.env.E2E_TEST_USER_PASSWORD;

// Skip entire file when no credentials are present.
test.skip(
  !CLEANER_EMAIL || !CLEANER_PASSWORD,
  'E2E_CLEANER_EMAIL / E2E_CLEANER_PASSWORD must be set to a cleaner account in the preview DB',
);

// Phone viewport for all tests in this file.
test.use({ viewport: { width: 375, height: 812 } });

// ---------------------------------------------------------------------------
// Shared sign-in helper (mirrors the pattern in settings.spec.ts).
// ---------------------------------------------------------------------------
async function signInAsCleaner(page: import('@playwright/test').Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page
    .locator('input[name="email"], input[type="email"]')
    .first()
    .fill(CLEANER_EMAIL!);
  await page
    .locator('input[name="password"], input[type="password"]')
    .first()
    .fill(CLEANER_PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Any dashboard landing is fine - we'll navigate explicitly after.
  await page.waitForURL(/dashboard/, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Test 1: redesign cleaner shell renders on /app/cleaner-dashboard
// ---------------------------------------------------------------------------
test('redesign cleaner shell renders at /app/cleaner-dashboard', async ({
  page,
}) => {
  await signInAsCleaner(page);

  await page.goto('/app/cleaner-dashboard', { waitUntil: 'domcontentloaded' });

  // If the user is not a cleaner role, the app may redirect away.
  // Detect that and skip rather than fail.
  const currentUrl = page.url();
  if (!currentUrl.includes('/app/cleaner-dashboard')) {
    test.info().annotations.push({
      type: 'skip-reason',
      description: `Signed-in user redirected away from /app/cleaner-dashboard (landed on ${currentUrl}). Check that E2E_CLEANER_EMAIL is a cleaner role account.`,
    });
    test.skip();
    return;
  }

  // The redesign cleaner shell must render a bottom nav or the main content area.
  // We accept either a nav element or at least a non-empty body.
  await expect(page.locator('body')).not.toBeEmpty();

  // A page heading, nav element, or a recognisable text token from the cleaner shell.
  const shellPresent =
    (await page.locator('nav').count()) > 0 ||
    (await page.getByText(/today|schedule|earnings|messages/i).count()) > 0;

  expect(
    shellPresent,
    'Cleaner shell should render a nav or recognisable section labels',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 2: active-job overview renders when an in_progress job exists
// ---------------------------------------------------------------------------
test('active-job overview renders when an in_progress job is reachable', async ({
  page,
}) => {
  await signInAsCleaner(page);

  // Navigate to the Schedule tab - most likely surface for an in_progress job.
  await page.goto('/app/cleaner-dashboard/schedule', {
    waitUntil: 'domcontentloaded',
  });

  // Also check Today.
  const scheduleUrl = page.url();
  if (!scheduleUrl.includes('/app/cleaner-dashboard')) {
    test.info().annotations.push({
      type: 'skip-reason',
      description: 'Redirected away from cleaner dashboard - not a cleaner account.',
    });
    test.skip();
    return;
  }

  // Wait briefly for content to hydrate.
  await page.waitForTimeout(2_000);

  // Look for an in_progress job. The redesign job rows carry text like
  // "In progress", "Active", or "Resume". The job-detail takeover is opened by
  // tapping a row; the active-job overlay is rendered by CleanerActiveJob when
  // appointment.status === 'in_progress'.
  const inProgressRow = page
    .getByRole('button')
    .filter({ hasText: /in.?progress|active|resume/i })
    .first();

  const rowVisible = await inProgressRow.isVisible().catch(() => false);

  if (!rowVisible) {
    // No in_progress job in the seed database - skip cleanly.
    test.info().annotations.push({
      type: 'skip-reason',
      description:
        'No in_progress job found on the Schedule page. Seed an in_progress appointment for a cleaner account to cover this path.',
    });
    test.skip();
    return;
  }

  // Tap the row to open the job-detail takeover.
  await inProgressRow.click();

  // The full-screen overlay should appear. The active-job view renders an
  // "Active job" label and "Before photos", "Checklist", "After photos" cards.
  await expect(
    page.getByText(/active job/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Three section cards must be present.
  await expect(
    page.getByRole('button', { name: /before photos/i }),
  ).toBeVisible({ timeout: 5_000 });

  await expect(
    page.getByRole('button', { name: /checklist/i }),
  ).toBeVisible({ timeout: 5_000 });

  await expect(
    page.getByRole('button', { name: /after photos/i }),
  ).toBeVisible({ timeout: 5_000 });

  // The persistent "Complete job" bar must be present (may be disabled).
  await expect(
    page.getByRole('button', { name: /complete job/i }),
  ).toBeVisible({ timeout: 5_000 });
});
