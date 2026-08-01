import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/profile
 *
 * Owner-only org-profile editor: name, logo_url, billing_email, default_payout_model.
 * default_payout_model is validated server-side so a stale or hand-rolled
 * client can't write a model the rest of the system can't honor.
 *
 * Body (all optional, at least one required): { name, logo_url, billing_email, default_payout_model }.
 */
const PAYOUT_MODELS = ['percentage', 'flat', 'request', 'hourly_external'] as const;
type PayoutModel = (typeof PAYOUT_MODELS)[number];

// hourly_external stays unselectable: its payment pipeline isn't built yet.
const ENABLED_PAYOUT_MODELS: PayoutModel[] = ['percentage', 'flat', 'request'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await params;

    const auth = await requireOrgAuth(request, orgId, supabaseAdmin, {
      allowedRoles: ['owner'],
    });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      logo_url?: string | null;
      billing_email?: string | null;
      default_payout_model?: string;
    };

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 1 || name.length > 200) {
        return NextResponse.json(
          { error: 'name must be 1–200 characters' },
          { status: 400 },
        );
      }
      update.name = name;
    }

    if (body.logo_url !== undefined) {
      if (body.logo_url === null || body.logo_url === '') {
        update.logo_url = null;
      } else {
        const url = String(body.logo_url).trim();
        if (!/^https?:\/\//i.test(url) || url.length > 1000) {
          return NextResponse.json(
            { error: 'logo_url must be an http(s) URL up to 1000 chars' },
            { status: 400 },
          );
        }
        update.logo_url = url;
      }
    }

    if (body.billing_email !== undefined) {
      if (body.billing_email === null || body.billing_email === '') {
        update.billing_email = null;
      } else {
        const email = String(body.billing_email).trim().toLowerCase();
        // Loose email regex — Stripe will reject malformed addresses anyway.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
          return NextResponse.json(
            { error: 'billing_email must be a valid email address' },
            { status: 400 },
          );
        }
        update.billing_email = email;
      }
    }

    if (body.default_payout_model !== undefined) {
      // 'percentage_contractor' was renamed to 'percentage' in migration 117;
      // accept the old spelling from not-yet-redeployed clients, write the new one.
      const m =
        body.default_payout_model === 'percentage_contractor' ? 'percentage' : body.default_payout_model;
      if (!PAYOUT_MODELS.includes(m as PayoutModel)) {
        return NextResponse.json(
          { error: 'default_payout_model must be percentage, flat, request, or hourly_external' },
          { status: 400 },
        );
      }
      if (!ENABLED_PAYOUT_MODELS.includes(m as PayoutModel)) {
        return NextResponse.json(
          { error: 'That payout model is not yet available' },
          { status: 400 },
        );
      }
      // Migration 118 (this PR) backfilled the data and flipped the column
      // default, so the unified spelling is written directly. (117's PR wrote
      // the legacy spelling through the constraint-widening deploy window.)
      update.default_payout_model = m;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('organizations').update(update).eq('id', orgId);
    if (error) {
      return NextResponse.json(
        { error: 'Failed to update organization', details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, ...update });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
