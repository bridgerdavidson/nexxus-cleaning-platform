import { test, expect } from '@playwright/test';

test('home page renders and produces no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore noisy framework/preview-only warnings that aren't actionable here.
      if (/_next\/static|favicon|font/i.test(text)) return;
      errors.push(`console.error: ${text}`);
    }
  });

  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response, 'no response from baseURL — is the dev server / preview up?').not.toBeNull();
  expect(response!.status(), `got ${response!.status()} for /`).toBeLessThan(400);

  // Page should have rendered *some* content under <body>.
  await expect(page.locator('body')).not.toBeEmpty();

  expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
});

test('login page is reachable', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // The login form lives under various selectors depending on auth flow,
  // but at minimum the URL should resolve and there should be an email input.
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible({
    timeout: 10_000,
  });
});
