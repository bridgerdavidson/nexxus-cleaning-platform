/**
 * E2E smoke: the cleaner-request pay model.
 *
 * Covers both directions of the flow that money depends on:
 *   (a) cleaner names their pay at completion (auto-approve or escalation),
 *   (b) org sees the escalated request in the Payments queue and acts on it.
 *
 * Resilient by design, like the other cleaner specs in this suite: the preview
 * environment's seed data is uncertain, and this feature additionally needs a
 * cleaner whose payout_model is 'request'. Until the pilot flips that on, the
 * fragile steps degrade to test.skip() rather than failing the gate. What the
 * spec DOES assert is unconditional once its precondition is visible on screen.
 *
 * Env vars:
 *   E2E_CLEANER_EMAIL / E2E_CLEANER_PASSWORD           (or the _TEST_USER_ variants)
 *   E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD       (org admin, for the queue test)
 */

import { test, expect, type Page } from '@playwright/test';

const CLEANER_EMAIL =
  process.env.E2E_CLEANER_EMAIL ??
  process.env.E2E_TEST_USER_EMAIL_CLEANER ??
  process.env.E2E_TEST_USER_EMAIL;
const CLEANER_PASSWORD =
  process.env.E2E_CLEANER_PASSWORD ??
  process.env.E2E_TEST_USER_PASSWORD_CLEANER ??
  process.env.E2E_TEST_USER_PASSWORD;

const ADMIN_EMAIL = process.env.E2E_TEST_USER_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_TEST_USER_PASSWORD;

/**
 * Sign in. Returns false (never throws) if the flow does not complete.
 *
 * Retries the whole fill-and-submit rather than just the fill. The login form
 * is React-controlled and client-rendered, so before hydration completes two
 * things go wrong silently: a fill is reset to empty, and a click lands on a
 * button whose handler is not attached yet. Either one leaves the page sitting
 * on /login, which is indistinguishable from bad credentials. Re-submitting
 * until the URL actually changes makes this reliable instead of a spec that
 * skips itself and quietly proves nothing.
 */
async function signIn(page: Page, email: string, password: string): Promise<boolean> {
  const emailSel = 'input[name="email"], input[type="email"]';
  const pwSel = 'input[name="password"], input[type="password"]';
  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator(emailSel).first().waitFor({ state: 'visible', timeout: 15_000 });

    for (let attempt = 0; attempt < 6; attempt++) {
      const emailInput = page.locator(emailSel).first();
      const pwInput = page.locator(pwSel).first();
      await emailInput.fill(email);
      await pwInput.fill(password);
      if ((await emailInput.inputValue()) !== email) {
        await page.waitForTimeout(500);
        continue;
      }
      await page.getByRole('button', { name: /sign in|log in|continue/i }).first().click();
      try {
        await page.waitForURL(/\/(admin|cleaner|homeowner|owner)(?:\/|\?|$)/, { timeout: 8_000 });
        return true;
      } catch {
        // Still on /login: hydration had not wired the submit yet. Try again.
      }
    }
    return false;
  } catch {
    return false;
  }
}

test.describe('cleaner pay requests', () => {
  test.skip(
    !CLEANER_EMAIL || !CLEANER_PASSWORD,
    'Cleaner credentials must be set to run the pay-request smoke test',
  );
  test.use({ viewport: { width: 375, height: 812 } });

  test('completion asks a request-mode cleaner to name their pay, and never shows the job price', async ({
    page,
  }) => {
    test.skip(!(await signIn(page, CLEANER_EMAIL!, CLEANER_PASSWORD!)), 'Sign-in unavailable');

    await page.goto('/cleaner', { waitUntil: 'domcontentloaded' });
    // Wait for the dashboard's own data to land before deciding there is no
    // active job, otherwise the probe races the first render and the whole
    // spec skips for the wrong reason.
    await page
      .getByRole('button', { name: /continue job|start job/i })
      .first()
      .waitFor({ state: 'visible', timeout: 25_000 })
      .catch(() => {});

    const continueBtn = page.getByRole('button', { name: /continue job/i }).first();
    if (!(await continueBtn.isVisible().catch(() => false))) {
      test.skip(true, 'No in-progress job seeded for this cleaner');
    }
    await continueBtn.click();

    const completeBtn = page.getByRole('button', { name: /^complete job$/i }).first();
    if (!(await completeBtn.isEnabled({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Active job has unmet completion gates (photos/checklist)');
    }
    await completeBtn.click();

    const amountInput = page.locator('#cl-request-amount');
    if (!(await amountInput.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'Assigned cleaner is not in request mode');
    }

    // Precondition met: from here the assertions are unconditional.
    // The request step replaces the percentage breakdown entirely.
    await expect(page.getByText(/request your pay/i)).toBeVisible();
    await expect(page.getByText(/your cut/i)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /send request and complete/i }),
    ).toBeVisible();
  });

  test('earnings shows open pay negotiations and can accept an offer', async ({ page }) => {
    test.skip(!(await signIn(page, CLEANER_EMAIL!, CLEANER_PASSWORD!)), 'Sign-in unavailable');

    await page.goto('/cleaner/earnings', { waitUntil: 'domcontentloaded' });

    const yourTurn = page.getByText(/waiting on you/i).first();
    await yourTurn.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
    if (!(await yourTurn.isVisible().catch(() => false))) {
      test.skip(true, 'No countered pay request waiting for this cleaner');
    }

    // Open the thread: it must show the negotiation and an accept action whose
    // label carries the amount, so accepting is never a blind tap.
    await page.getByRole('button', { name: /tap to respond/i }).first().click();
    await expect(page.getByText(/your pay for this job/i)).toBeVisible({ timeout: 10_000 });
    const accept = page.getByRole('button', { name: /^accept \$/i }).first();
    await expect(accept).toBeVisible();
    await expect(page.getByRole('button', { name: /ask for a different amount/i })).toBeVisible();

    await accept.click();
    // Accepting closes the thread and clears it from the queue.
    await expect(page.getByText(/your pay for this job/i)).toBeHidden({ timeout: 15_000 });
  });
});

test.describe('operator pay-request queue', () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'Admin credentials must be set to run the operator queue test',
  );

  test('escalated requests reach the Payments queue with the margin shown', async ({ page }) => {
    test.skip(!(await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!)), 'Sign-in unavailable');

    await page.goto('/admin/payments', { waitUntil: 'domcontentloaded' });

    const band = page.getByRole('heading', { name: /^pay requests$/i });
    await band.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
    if (!(await band.isVisible().catch(() => false))) {
      // The band hides entirely when there is nothing open, which is the
      // correct all-clear state, not a failure.
      test.skip(true, 'No open pay requests in this environment');
    }

    // The operator must see what the job is worth, what was asked, and what
    // that leaves them, before any approve action.
    await expect(page.getByText(/job price/i).first()).toBeVisible();
    await expect(page.getByText(/leaves you|above job price/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve \$/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^review$/i }).first()).toBeVisible();
  });
});
