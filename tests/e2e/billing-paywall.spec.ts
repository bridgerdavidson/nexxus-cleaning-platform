/**
 * The paywall escape hatch, end to end.
 *
 * WHY THIS EXISTS: PR F's full-screen paywall covers a frozen cleaning
 * company's own schedule. The "View your data" button is the only way out.
 * Asana shipped exactly this pattern and their escape link silently
 * disappeared for some accounts, leaving a non-dismissible "Your trial has
 * ended" modal sitting on top of the customer's own data. The complaint
 * thread ran for years. This suite is what stops that from happening here:
 * it proves the escape works, that it still works a SECOND time after the
 * wall reopens, and that escaping never leaves the user silently read-only.
 *
 * FLAG-DARK EVERYWHERE BUT LOCAL: every surface this suite touches renders
 * `null` unless NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED is `'true'`. CI runs
 * Playwright against the Vercel preview, where that var is unset, so this
 * guard skips the whole file there instead of failing on elements that were
 * never going to render. It only truly executes locally, with the flag set
 * on BOTH `npm run dev` and this test process:
 *
 *   NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED=true npm run dev
 *   NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED=true PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *     npm run test:e2e -- billing-paywall
 *
 * A permanently-skipping suite is worse than no suite at all: it reads as
 * coverage while guarding nothing. Getting NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED
 * onto the Vercel PREVIEW environment (never production) is a separate ops
 * step, tracked outside this file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  withTestOrg,
  addOwnerToOrg,
  addManagerToOrg,
  type TestOrgFixture,
  type OwnerMemberHandle,
  type ManagerMemberHandle,
} from '../helpers/fixtures';
import { createTestSupabaseClient } from '../helpers/supabase';

const billingUiOn = process.env.NEXT_PUBLIC_BILLING_ENFORCEMENT_ENABLED === 'true';
test.skip(!billingUiOn, 'billing UI is flag-dark in this environment');

/**
 * Local DB seeding needs Supabase service-role creds. Vitest's config loads
 * `.env.test.local` at worker boot (vitest.config.mts); Playwright has no
 * equivalent, so pull the same file in here. Never overrides a value the
 * shell already exported, and never throws on a missing file: with no creds
 * present, `withTestOrg()` fails loudly on its own with a clear message,
 * which is the right failure mode once seeding actually runs.
 */
function loadLocalEnv(): void {
  for (const file of ['.env.test.local', '.env.local']) {
    let text: string;
    try {
      text = readFileSync(join(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const match = /^\s*([\w.]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
}
if (billingUiOn) loadLocalEnv();

const EXPIRED_TRIAL_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/**
 * Sign in through the real login form. Retries the fill-and-submit (not just
 * the fill): the form is client-rendered, so a submit before hydration
 * completes silently does nothing and leaves the page sitting on /login,
 * indistinguishable from bad credentials. These credentials are always
 * freshly seeded and valid, so a failure here is a hard failure, not a skip.
 */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  const emailSel = 'input[name="email"], input[type="email"]';
  const pwSel = 'input[name="password"], input[type="password"]';
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator(emailSel).first().waitFor({ state: 'visible', timeout: 15_000 });

  for (let attempt = 0; attempt < 3; attempt++) {
    const emailInput = page.locator(emailSel).first();
    const pwInput = page.locator(pwSel).first();
    await emailInput.fill(email);
    await pwInput.fill(password);
    if ((await emailInput.inputValue()) !== email) {
      await page.waitForTimeout(400);
      continue;
    }
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    try {
      await page.waitForURL(/\/(admin|cleaner|homeowner|owner)(?:\/|\?|$)/, { timeout: 15_000 });
      return;
    } catch {
      // fall through and retry
    }
  }
  throw new Error(`sign-in never reached a dashboard route for ${email}`);
}

const PAYWALL_HEADLINE = 'Your trial has ended';
const PLAN_PICKER_SUBMIT = 'Continue to payment';
const ESCAPE_HATCH = 'View your data';
const NEW_BOOKING = 'New booking';
const OWNER_VIEW_ONLY_BAR =
  'View-only mode. Your trial ended, so new bookings are paused. Scheduled jobs still run.';
const MANAGER_EXPLANATION =
  'View-only mode. New bookings are paused until the account owner updates the plan. Scheduled jobs still run.';
const GREETING = /^good (morning|afternoon|evening)/i;

async function expectWallVisible(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: PAYWALL_HEADLINE })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: PLAN_PICKER_SUBMIT })).toBeVisible();
}

async function expectWallGone(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: PAYWALL_HEADLINE })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: GREETING })).toBeVisible({ timeout: 10_000 });
}

test.describe('Billing paywall escape hatch', () => {
  let frozenOrg: TestOrgFixture;
  let frozenOwner: OwnerMemberHandle;
  let frozenManager: ManagerMemberHandle;
  let trialOrg: TestOrgFixture;

  test.beforeAll(async () => {
    // frozen org: trial expired yesterday, so deriveBillingAccess reports
    // state 'trial_expired' / frozen true for every member.
    frozenOrg = await withTestOrg({
      billing: { subscription_status: 'trialing', trial_ends_at: EXPIRED_TRIAL_ISO },
    });
    frozenOwner = await addOwnerToOrg(frozenOrg.organizationId);
    frozenManager = await addManagerToOrg(frozenOrg.organizationId);

    // The owner-only onboarding "Welcome" dialog (OperatorOverview.tsx) opens
    // full-screen on a first-ever dashboard view and would sit on top of the
    // shell's "New booking" button, breaking the reopen/re-escape cases below.
    // Mark it seen up front: this suite is testing the paywall, not onboarding.
    const admin = createTestSupabaseClient();
    const { error } = await admin
      .from('user_profiles')
      .update({ welcome_seen_at: new Date().toISOString() })
      .eq('id', frozenOwner.userId);
    if (error) throw new Error(`failed to pre-seed welcome_seen_at: ${error.message}`);

    // trialing org: withTestOrg's default billing is a live 14-day trial, so
    // this org is left untouched. Its seeded admin (org role 'admin') can see
    // billing chrome (owner or admin only) without needing a dedicated owner.
    trialOrg = await withTestOrg();
  });

  test.afterAll(async () => {
    await frozenOwner?.cleanup();
    await frozenManager?.cleanup();
    await frozenOrg?.cleanup();
    await trialOrg?.cleanup();
  });

  test('1. a frozen org owner lands on the wall', async ({ page }) => {
    await signIn(page, frozenOwner.email, frozenOwner.password);
    await expectWallVisible(page);
  });

  test('2. View your data dismisses the wall and reveals the real dashboard', async ({ page }) => {
    await signIn(page, frozenOwner.email, frozenOwner.password);
    await expectWallVisible(page);

    await page.getByRole('button', { name: ESCAPE_HATCH }).click();

    await expectWallGone(page);
  });

  test('3. after escaping, the view-only bar is still present', async ({ page }) => {
    await signIn(page, frozenOwner.email, frozenOwner.password);
    await expectWallVisible(page);

    await page.getByRole('button', { name: ESCAPE_HATCH }).click();
    await expectWallGone(page);

    // The user must never be read-only without being told. This bar is
    // non-dismissible (ruling R14) and stays up regardless of the wall.
    await expect(page.getByText(OWNER_VIEW_ONLY_BAR)).toBeVisible();
  });

  test('4. New booking is visible after escaping and reopens the wall', async ({ page }) => {
    await signIn(page, frozenOwner.email, frozenOwner.password);
    await expectWallVisible(page);

    await page.getByRole('button', { name: ESCAPE_HATCH }).click();
    await expectWallGone(page);

    // Frozen, so the button carries aria-disabled (visual-only, per
    // OperatorTopBar.tsx: no `disabled` attribute, real mouse clicks still
    // land). `force: true` matches that real-user behavior; Playwright's own
    // actionability check treats aria-disabled as blocking, which a mouse
    // click does not.
    const newBooking = page.getByRole('button', { name: NEW_BOOKING });
    await expect(newBooking).toBeVisible();
    await newBooking.click({ force: true });

    await expectWallVisible(page);
  });

  test('5. View your data works a second time after the wall reopens', async ({ page }) => {
    // THE Asana regression: an escape that works once and then stops.
    await signIn(page, frozenOwner.email, frozenOwner.password);
    await expectWallVisible(page);

    await page.getByRole('button', { name: ESCAPE_HATCH }).click();
    await expectWallGone(page);

    // See case 4: real-user force click through the visual-only aria-disabled state.
    await page.getByRole('button', { name: NEW_BOOKING }).click({ force: true });
    await expectWallVisible(page);

    await page.getByRole('button', { name: ESCAPE_HATCH }).click();
    await expectWallGone(page);
  });

  test('6. a frozen org manager sees the explanation bar and no wall', async ({ page }) => {
    await signIn(page, frozenManager.email, frozenManager.password);

    await expect(page.getByText(MANAGER_EXPLANATION)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: PAYWALL_HEADLINE })).toHaveCount(0);
    await expect(page.getByRole('button', { name: PLAN_PICKER_SUBMIT })).toHaveCount(0);
  });

  test('7. a trialing org with more than 3 days left shows the pill, no banner, no wall', async ({
    page,
  }) => {
    await signIn(page, trialOrg.admin.email, trialOrg.admin.password);

    await expect(page.getByText(/^Trial, \d+ days left$/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: PAYWALL_HEADLINE })).toHaveCount(0);
    await expect(page.getByText(OWNER_VIEW_ONLY_BAR)).toHaveCount(0);
    await expect(page.getByText(MANAGER_EXPLANATION)).toHaveCount(0);
  });
});
