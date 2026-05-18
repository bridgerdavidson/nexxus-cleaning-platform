import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

// Vercel preview deploys are gated by Deployment Protection. The bypass token
// (Vercel → Settings → Deployment Protection → Protection Bypass for Automation)
// lets Playwright through. Sent as a header on every request.
const bypassToken = process.env.VERCEL_PROTECTION_BYPASS_TOKEN;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    extraHTTPHeaders: bypassToken ? { 'x-vercel-protection-bypass': bypassToken } : undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // No `webServer` block: in local dev you run `npm run dev` yourself; in CI we
  // hit the live Vercel preview URL passed in via PLAYWRIGHT_BASE_URL.
});
