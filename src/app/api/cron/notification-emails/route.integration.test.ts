/**
 * Integration tests: the receipt email drain (audit T2-1b, MASTER-TODO 3.5).
 *
 * Runs the cron route against a real local Supabase with the SMTP layer mocked
 * (one mock on @/lib/email/sendEmail covers both sendEmail and emailConfigured,
 * per that module's contract). Asserts the outbox claim/retry state machine:
 * money rows email exactly once, non-money rows never email, failures un-claim
 * and bump failed_attempts, the attempts cap and send_after defer rows, and an
 * unconfigured SMTP touches nothing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('@/lib/email/sendEmail', () => ({
  sendEmail: vi.fn(async () => undefined),
  emailConfigured: vi.fn(() => true),
}));

import { POST } from './route';
import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { MAX_EMAIL_ATTEMPTS } from '@/lib/notifications/dispatchReceiptEmails';
import { callRoute } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

const CRON_SECRET = 'test-cron-secret';
const cronHeaders = { Authorization: `Bearer ${CRON_SECRET}` };

const sendEmailMock = vi.mocked(sendEmail);
const emailConfiguredMock = vi.mocked(emailConfigured);

describe('POST /api/cron/notification-emails', () => {
  const admin = createTestSupabaseClient();
  let org: TestOrgFixture;
  let originalSecret: string | undefined;

  async function seedEvent(row: {
    eventType: string;
    payload?: Record<string, unknown>;
    sendAfter?: string;
    emailDispatchedAt?: string | null;
    failedAttempts?: number;
  }): Promise<string> {
    const { data, error } = await admin
      .from('notification_events')
      .insert({
        organization_id: org.organizationId,
        recipient_user_id: org.homeowner.userId,
        event_type: row.eventType,
        payload: row.payload ?? {
          amount_cents: 12345,
          property_label: 'Maple Ave',
          scheduled_date: '2026-06-24',
        },
        ...(row.sendAfter ? { send_after: row.sendAfter } : {}),
        ...(row.emailDispatchedAt !== undefined ? { email_dispatched_at: row.emailDispatchedAt } : {}),
        ...(row.failedAttempts !== undefined ? { failed_attempts: row.failedAttempts } : {}),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`event seed failed: ${error?.message}`);
    return data.id as string;
  }

  async function getRow(id: string) {
    const { data } = await admin
      .from('notification_events')
      .select('email_dispatched_at, failed_attempts, last_error')
      .eq('id', id)
      .single();
    return data as { email_dispatched_at: string | null; failed_attempts: number; last_error: string | null };
  }

  beforeAll(async () => {
    originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = CRON_SECRET;
    org = await withTestOrg();
  });

  afterAll(async () => {
    process.env.CRON_SECRET = originalSecret;
    await org.cleanup();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    sendEmailMock.mockResolvedValue(undefined);
    emailConfiguredMock.mockReturnValue(true);
    // Each test owns its outbox: drop this org's rows so earlier tests can't leak into a drain.
    await admin.from('notification_events').delete().eq('organization_id', org.organizationId);
  });

  it('rejects a missing or wrong cron secret', async () => {
    const noAuth = await callRoute(POST, { method: 'POST', body: {} });
    expect(noAuth.status).toBe(401);
    const badAuth = await callRoute(POST, {
      method: 'POST',
      body: {},
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(badAuth.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('emails a due charge_succeeded row once: branded receipt to the homeowner, row stamped', async () => {
    const id = await seedEvent({ eventType: 'charge_succeeded' });

    const res = await callRoute<{ receipts: { sent: number } }>(POST, {
      method: 'POST',
      body: {},
      headers: cronHeaders,
    });
    expect(res.status).toBe(200);
    expect(res.body!.receipts.sent).toBe(1);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe(org.homeowner.email);
    expect(call.subject).toContain('$123.45');
    expect(call.html).toContain('Maple Ave');

    const row = await getRow(id);
    expect(row.email_dispatched_at).not.toBeNull();

    // Second run: nothing left to send.
    const again = await callRoute<{ receipts: { sent: number } }>(POST, {
      method: 'POST',
      body: {},
      headers: cronHeaders,
    });
    expect(again.body!.receipts.sent).toBe(0);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('drains ONLY money receipt types: a job_started row is never emailed or claimed', async () => {
    const moneyId = await seedEvent({
      eventType: 'cancellation_fee_charged',
      payload: { amount_cents: 5000, reason: 'no_show' },
    });
    const otherId = await seedEvent({ eventType: 'job_started' });

    const res = await callRoute<{ receipts: { sent: number } }>(POST, {
      method: 'POST',
      body: {},
      headers: cronHeaders,
    });
    expect(res.body!.receipts.sent).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].subject).toContain('no-show fee');

    expect((await getRow(moneyId)).email_dispatched_at).not.toBeNull();
    expect((await getRow(otherId)).email_dispatched_at).toBeNull();
  });

  it('a failed send un-claims the row with attempts + error recorded, then the next run retries it', async () => {
    const id = await seedEvent({ eventType: 'refund_issued' });
    sendEmailMock.mockRejectedValueOnce(new Error('smtp timeout'));

    const first = await callRoute<{ receipts: { sent: number; failed: number } }>(POST, {
      method: 'POST',
      body: {},
      headers: cronHeaders,
    });
    expect(first.body!.receipts.failed).toBe(1);
    let row = await getRow(id);
    expect(row.email_dispatched_at).toBeNull();
    expect(row.failed_attempts).toBe(1);
    expect(row.last_error).toContain('smtp timeout');

    const second = await callRoute<{ receipts: { sent: number } }>(POST, {
      method: 'POST',
      body: {},
      headers: cronHeaders,
    });
    expect(second.body!.receipts.sent).toBe(1);
    row = await getRow(id);
    expect(row.email_dispatched_at).not.toBeNull();
  });

  it('rows at the attempts cap, scheduled for later, or already dispatched are left alone', async () => {
    const exhausted = await seedEvent({
      eventType: 'charge_succeeded',
      failedAttempts: MAX_EMAIL_ATTEMPTS,
    });
    const future = await seedEvent({
      eventType: 'charge_succeeded',
      sendAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const done = await seedEvent({
      eventType: 'charge_succeeded',
      emailDispatchedAt: new Date().toISOString(),
    });

    const res = await callRoute<{ receipts: { sent: number } }>(POST, {
      method: 'POST',
      body: {},
      headers: cronHeaders,
    });
    expect(res.body!.receipts.sent).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect((await getRow(exhausted)).email_dispatched_at).toBeNull();
    expect((await getRow(future)).email_dispatched_at).toBeNull();
    expect((await getRow(done)).failed_attempts).toBe(0);
  });

  it('with SMTP unconfigured the drain claims nothing and reports skipped', async () => {
    const id = await seedEvent({ eventType: 'charge_succeeded' });
    emailConfiguredMock.mockReturnValue(false);

    const res = await callRoute<{ receipts: { skipped?: string; sent: number } }>(POST, {
      method: 'POST',
      body: {},
      headers: cronHeaders,
    });
    expect(res.status).toBe(200);
    expect(res.body!.receipts.skipped).toBe('smtp_unconfigured');
    expect(sendEmailMock).not.toHaveBeenCalled();
    const row = await getRow(id);
    expect(row.email_dispatched_at).toBeNull();
    expect(row.failed_attempts).toBe(0);
  });
});
