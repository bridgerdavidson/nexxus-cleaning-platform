// Ruling R24: two Stripe Customer Portal configurations.
//
// These payloads are the whole of the rule. scripts/stripe-billing-setup.ts has
// never been run against a real Stripe account, so nothing downstream observes a
// wrong flag here until the day someone runs it in live mode and an admin sent
// to fix a card finds a Cancel subscription button. That makes this file the
// only guard, so every assertion below is a specific way the pair can go wrong.

import { describe, expect, it } from 'vitest';
import {
  PORTAL_CONFIGURATIONS,
  PORTAL_VARIANTS,
  portalVariantForRole,
  type PortalVariant,
} from './portalConfigurations';

const EM_DASH = '—';

const features = (variant: PortalVariant) =>
  PORTAL_CONFIGURATIONS[variant].features as Record<string, { enabled?: boolean } | undefined>;

describe('portalVariantForRole', () => {
  // Mutation target: "give the admin the default portal too".
  it('gives the full portal to an owner and the remediation portal to an admin', () => {
    expect(portalVariantForRole('owner')).toBe('default');
    expect(portalVariantForRole('admin')).toBe('remediation');
  });

  // Fails closed. A role added to this app later must not acquire the cancel
  // button by being forgotten here, and neither must a missing role.
  it('gives the remediation portal to every other role, and to no role at all', () => {
    for (const role of ['manager', 'cleaner', 'homeowner', 'Owner', 'OWNER', '', 'anything']) {
      expect(portalVariantForRole(role), role).toBe('remediation');
    }
    expect(portalVariantForRole(null)).toBe('remediation');
    expect(portalVariantForRole(undefined)).toBe('remediation');
  });
});

describe('the remediation (admin) configuration', () => {
  // THE mutation target of this whole ruling: "create the remediation config
  // with subscription_cancel enabled". An admin may fix what is owed; an admin
  // may not end the agreement.
  it('cannot cancel the subscription', () => {
    expect(features('remediation').subscription_cancel).toEqual({ enabled: false });
  });

  // Plan changes run through the app, which enforces the seat bounds and the
  // seats-in-use floor Stripe knows nothing about.
  it('cannot change the plan', () => {
    expect(features('remediation').subscription_update).toEqual({ enabled: false });
  });

  // The reason an admin is sent here at all: rescue a failing subscription.
  it('can update the payment method and read the invoices', () => {
    expect(features('remediation').payment_method_update).toEqual({ enabled: true });
    expect(features('remediation').invoice_history).toEqual({ enabled: true });
  });
});

describe('the default (owner) configuration', () => {
  // Cancelling must be no harder than subscribing (ROSCA, California ARL), and
  // this portal is the only cancel flow the product has. Mutation target:
  // "turn cancel off everywhere so no one can reach it".
  it('keeps self-serve cancellation, at period end, with the reason survey', () => {
    const cancel = PORTAL_CONFIGURATIONS.default.features.subscription_cancel;
    expect(cancel?.enabled).toBe(true);
    expect(cancel?.mode).toBe('at_period_end');
    expect(cancel?.cancellation_reason?.enabled).toBe(true);
    expect((cancel?.cancellation_reason?.options ?? []).length).toBeGreaterThan(1);
  });

  it('still keeps plan changes in the app', () => {
    expect(features('default').subscription_update).toEqual({ enabled: false });
  });

  it('can update the payment method and read the invoices', () => {
    expect(features('default').payment_method_update).toEqual({ enabled: true });
    expect(features('default').invoice_history).toEqual({ enabled: true });
  });
});

describe('both configurations', () => {
  it('covers exactly the two variants, each tagged with its own name', () => {
    expect([...PORTAL_VARIANTS].sort()).toEqual(['default', 'remediation']);
    for (const variant of PORTAL_VARIANTS) {
      // resolvePortalConfiguration finds a configuration by this tag alone. A
      // mismatch would throw at the first portal click, in production.
      expect(PORTAL_CONFIGURATIONS[variant].metadata?.nexxus_portal, variant).toBe(variant);
      expect(PORTAL_CONFIGURATIONS[variant].metadata?.source, variant).toBe(
        'nexxus-cleaning-platform',
      );
    }
    expect(Object.keys(PORTAL_CONFIGURATIONS).sort()).toEqual([...PORTAL_VARIANTS].sort());
  });

  it('lets the org keep its own billing contact details up to date', () => {
    for (const variant of PORTAL_VARIANTS) {
      expect(PORTAL_CONFIGURATIONS[variant].features.customer_update, variant).toEqual({
        enabled: true,
        allowed_updates: ['email', 'address', 'name'],
      });
    }
  });

  // The headline renders on Stripe's hosted page, so it is product copy.
  it('carries a headline, with no em dash', () => {
    for (const variant of PORTAL_VARIANTS) {
      const headline = PORTAL_CONFIGURATIONS[variant].business_profile?.headline ?? '';
      expect(headline.length, variant).toBeGreaterThan(0);
      expect(headline, variant).not.toContain(EM_DASH);
    }
  });

  // Passing is_default would fight the Stripe Dashboard over which
  // configuration an unconfigured session falls back to. We always name one.
  it('claims neither as the Stripe account default', () => {
    for (const variant of PORTAL_VARIANTS) {
      expect('is_default' in PORTAL_CONFIGURATIONS[variant], variant).toBe(false);
    }
  });

  // The two differ in exactly one thing. Anything else drifting apart means an
  // admin cannot do something a card rescue actually needs.
  it('differ only in cancellation and in the headline', () => {
    const strip = (variant: PortalVariant) => {
      const config = { ...PORTAL_CONFIGURATIONS[variant] } as Record<string, unknown>;
      delete config.business_profile;
      delete config.metadata;
      const features = { ...(config.features as Record<string, unknown>) };
      delete features.subscription_cancel;
      config.features = features;
      return config;
    };
    expect(strip('remediation')).toEqual(strip('default'));
  });
});
