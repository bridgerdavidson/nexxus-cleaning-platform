import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The global setup mocks @/lib/stripe so getStripe() throws. listSavedCards / detachPaymentMethod
// call Stripe internally, so mock that module here while still exercising the route's auth,
// self-scoping, and profile→customer resolution.
vi.mock('@/lib/stripe/customers/homeowner', () => ({
  listSavedCards: vi.fn(async () => [
    { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030, isDefault: true },
  ]),
  detachPaymentMethod: vi.fn(async (_customerId: string, pm: string) => pm === 'pm_owned'),
  setDefaultPaymentMethod: vi.fn(async (_customerId: string, pm: string) => pm === 'pm_owned'),
}));

import { GET, DELETE, PATCH } from './route';
import { callRoute, bearerHeader } from '../../../../../tests/helpers/auth';
import { withTestOrg, type TestOrgFixture } from '../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient } from '../../../../../tests/helpers/supabase';

describe('/api/stripe/my-payment-methods', () => {
  let org: TestOrgFixture;
  let originalEnabled: string | undefined;
  let originalFlow: string | undefined;

  beforeEach(async () => {
    originalEnabled = process.env.STRIPE_ENABLED;
    originalFlow = process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED;
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'true';
    org = await withTestOrg();
  });

  afterEach(async () => {
    process.env.STRIPE_ENABLED = originalEnabled;
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = originalFlow;
    await org.cleanup();
  });

  it('GET returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(GET, { method: 'GET' });
    expect(status).toBe(401);
  });

  it('GET returns 404 when the new charge flow is disabled', async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const { status } = await callRoute(GET, {
      method: 'GET',
      headers: bearerHeader(org.homeowner.accessToken),
    });
    expect(status).toBe(404);
  });

  it('GET returns an empty list when the homeowner has no Stripe customer yet', async () => {
    const { status, body } = await callRoute<{ success: boolean; cards: unknown[] }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.homeowner.accessToken),
    });
    expect(status).toBe(200);
    expect(body.cards).toEqual([]);
  });

  it('GET returns the saved cards once a Stripe customer is on file', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test' })
      .eq('id', org.homeowner.userId);

    const { status, body } = await callRoute<{ cards: { id: string }[] }>(GET, {
      method: 'GET',
      headers: bearerHeader(org.homeowner.accessToken),
    });
    expect(status).toBe(200);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].id).toBe('pm_1');
  });

  it('DELETE returns 400 without payment_method_id', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test' })
      .eq('id', org.homeowner.userId);

    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {},
    });
    expect(status).toBe(400);
  });

  it('DELETE detaches a card the caller owns', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test' })
      .eq('id', org.homeowner.userId);

    const { status, body } = await callRoute<{ success: boolean }>(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { payment_method_id: 'pm_owned' },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('DELETE returns 404 for a card that is not on the caller’s customer', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test' })
      .eq('id', org.homeowner.userId);

    const { status } = await callRoute(DELETE, {
      method: 'DELETE',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { payment_method_id: 'pm_someone_else' },
    });
    expect(status).toBe(404);
  });

  it('PATCH returns 404 when the new charge flow is disabled', async () => {
    process.env.STRIPE_NEW_CHARGE_FLOW_ENABLED = 'false';
    const { status } = await callRoute(PATCH, {
      method: 'PATCH',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { payment_method_id: 'pm_owned' },
    });
    expect(status).toBe(404);
  });

  it('PATCH returns 401 with no Authorization header', async () => {
    const { status } = await callRoute(PATCH, { method: 'PATCH', body: { payment_method_id: 'pm_owned' } });
    expect(status).toBe(401);
  });

  it('PATCH returns 400 without payment_method_id', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test' })
      .eq('id', org.homeowner.userId);

    const { status } = await callRoute(PATCH, {
      method: 'PATCH',
      headers: bearerHeader(org.homeowner.accessToken),
      body: {},
    });
    expect(status).toBe(400);
  });

  it('PATCH promotes a card the caller owns to default', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test' })
      .eq('id', org.homeowner.userId);

    const { status, body } = await callRoute<{ success: boolean }>(PATCH, {
      method: 'PATCH',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { payment_method_id: 'pm_owned' },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('PATCH returns 404 for a card that is not on the caller’s customer', async () => {
    const db = createTestSupabaseClient();
    await db
      .from('user_profiles')
      .update({ stripe_customer_id: 'cus_test' })
      .eq('id', org.homeowner.userId);

    const { status } = await callRoute(PATCH, {
      method: 'PATCH',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { payment_method_id: 'pm_someone_else' },
    });
    expect(status).toBe(404);
  });
});
