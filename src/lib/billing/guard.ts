// The server-side paywall. Returns 402 from write routes when an organization
// is frozen, so a tenant that stopped paying cannot create new work while still
// being able to read everything they have and pay to unfreeze.
//
// NEVER import this from src/lib/payments/**, src/app/api/cron/**, or
// src/app/api/stripe/webhook/**. Freezing an organization must stop new work,
// never stop money already in flight. guard.test.ts enforces that in CI.
//
// Spec: docs/superpowers/specs/2026-09-08-saas-billing-design.md §11.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ORG_BILLING_COLUMNS, deriveBillingAccess, type OrgBillingRow } from './access';
import { billingEnforcementEnabled } from './flags';

export type AssertWritableResult = { ok: true } | { ok: false; response: NextResponse };

const WRITABLE: AssertWritableResult = { ok: true };

/**
 * 402 when the organization is frozen, otherwise ok.
 *
 * Fails open on every uncertainty: flag off, no organization id, missing row, or
 * a query error. A transient database problem must never freeze every tenant at
 * once, and a bad id must produce the route's own 404 rather than a confusing 402.
 */
export async function assertOrgWritable(
  supabaseAdmin: SupabaseClient,
  organizationId: string | null | undefined,
): Promise<AssertWritableResult> {
  if (!billingEnforcementEnabled()) return WRITABLE;
  if (!organizationId) return WRITABLE;

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_BILLING_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();

  if (error) {
    console.error('assertOrgWritable: billing lookup failed, allowing the write', error.message);
    return WRITABLE;
  }
  if (!data) return WRITABLE;

  const org = data as unknown as OrgBillingRow;
  const access = deriveBillingAccess(org, new Date());
  if (!access.frozen) return WRITABLE;

  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'billing_frozen',
        state: access.state,
        trial_ends_at: org.trial_ends_at,
        can_extend_trial: access.canExtendTrial,
      },
      { status: 402 },
    ),
  };
}
