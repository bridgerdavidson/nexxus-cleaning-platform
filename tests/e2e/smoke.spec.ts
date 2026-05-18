import { test, expect } from '@playwright/test';

test('home page renders', async ({ page }) => {
  // Track unhandled JS exceptions only — these are real bugs.
  // Console.error noise (failed sub-resources, third-party SDK warnings) is
  // too unstable to assert against on a preview deploy.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response, 'no response from baseURL — is the dev server / preview up?').not.toBeNull();
  expect(response!.status(), `got ${response!.status()} for /`).toBeLessThan(400);

  await expect(page.locator('body')).not.toBeEmpty();

  expect(pageErrors, `unhandled JS exceptions: ${pageErrors.join('\n')}`).toEqual([]);
});

test('login page is reachable', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // The login form lives under various selectors depending on auth flow,
  // but at minimum the URL should resolve and there should be an email input.
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible({
    timeout: 10_000,
  });
});
