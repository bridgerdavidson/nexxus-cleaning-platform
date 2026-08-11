import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/branding
 *
 * Owner or admin sets the org's display identity: company name, brand color,
 * and logo URLs (white-label Phase 0, docs/white-label-branding.md). Wider
 * than the owner-only profile route on purpose: this is day-to-day appearance,
 * not billing identity. The name lives here (not on the profile route) because
 * it IS the brand: it renders as the wordmark, monogram, and tab title, and
 * the same owner/admin set already controls the logos it falls back to.
 *
 * Body (all optional, at least one required; null clears, name cannot be cleared):
 *   { name, brand_color, logo_icon_url, logo_full_url }
 *
 * Logo URLs must live under THIS org's prefix in the org-branding public
 * bucket, so the column can never point at an attacker-chosen host that would
 * then be embedded in email, and org A can never claim org B's asset.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await params;

    const auth = await requireOrgAuth(request, orgId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      brand_color?: string | null;
      logo_icon_url?: string | null;
      logo_full_url?: string | null;
    };

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 1 || name.length > 200) {
        return NextResponse.json(
          { error: 'Company name must be 1 to 200 characters' },
          { status: 400 },
        );
      }
      update.name = name;
    }

    if (body.brand_color !== undefined) {
      if (body.brand_color === null || body.brand_color === '') {
        update.brand_color = null;
      } else {
        const color = String(body.brand_color).trim();
        // Same shape the DB CHECK constraint enforces (migration 121); reject
        // here so the settings UI gets a friendly 400 instead of a 500.
        if (!/^#[0-9a-f]{6}$/i.test(color)) {
          return NextResponse.json(
            { error: 'brand_color must be a 6-digit hex color like #0150FC' },
            { status: 400 },
          );
        }
        update.brand_color = color;
      }
    }

    // Public-object prefix for this org's folder in the org-branding bucket.
    const bucketPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-branding/${orgId}/`;
    // Exactly the filenames the settings uploader writes: one path segment, no
    // traversal, no query, no encoding tricks. Checked against the NORMALIZED
    // URL: a raw startsWith is bypassable with dot segments ("<orgId>/../other/")
    // that every consumer resolves away.
    const filenameRe = /^(?:icon|full)-[A-Za-z0-9-]+\.(?:png|webp)$/;

    for (const field of ['logo_icon_url', 'logo_full_url'] as const) {
      const value = body[field];
      if (value === undefined) continue;
      if (value === null || value === '') {
        update[field] = null;
        continue;
      }
      const raw = String(value).trim();
      let normalized: string;
      try {
        normalized = new URL(raw).href;
      } catch {
        normalized = '';
      }
      const filename = normalized.startsWith(bucketPrefix)
        ? normalized.slice(bucketPrefix.length)
        : null;
      if (
        raw.length > 1000 ||
        filename === null ||
        !filenameRe.test(filename)
      ) {
        return NextResponse.json(
          { error: `${field} must be an org-branding upload belonging to this organization` },
          { status: 400 },
        );
      }
      update[field] = normalized;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // brand_updated_at drives the client-side logo cache-buster (?v=), so only
    // stamp it when a brand ASSET changed; a name-only save must not force
    // every client to refetch unchanged logo files.
    const touchesBrandAssets = ['brand_color', 'logo_icon_url', 'logo_full_url'].some(
      (f) => f in update,
    );
    if (touchesBrandAssets) update.brand_updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from('organizations').update(update).eq('id', orgId);
    if (error) {
      return NextResponse.json(
        { error: 'Failed to update branding', details: error.message },
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
