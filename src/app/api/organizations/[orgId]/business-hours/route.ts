import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * PATCH /api/organizations/:orgId/business-hours
 *
 * Owner/admin sets the org's IANA timezone and weekly business-hours map.
 * Body shape:
 *   {
 *     timezone?: "America/New_York",
 *     business_hours?: {
 *       mon: { open: "08:00", close: "17:00", closed: false },
 *       ... (mon..sun)
 *     }
 *   }
 *
 * Both fields are validated server-side; the timezone is checked against
 * Intl.supportedValuesOf when available, and falls back to a structural format
 * check (one '/' character, no spaces) for environments that lack the API.
 */
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];

function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(s);
}

function isValidTimezone(tz: string): boolean {
  // Intl.supportedValuesOf landed in Node 18 — guard for older runtimes.
  type IntlWithSupported = typeof Intl & { supportedValuesOf?: (k: string) => string[] };
  const supported = (Intl as IntlWithSupported).supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      return supported('timeZone').includes(tz);
    } catch {
      // fall through to structural check
    }
  }
  return /^[A-Za-z_]+(\/[A-Za-z_]+){1,2}$/.test(tz);
}

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
      timezone?: string;
      business_hours?: unknown;
    };

    const update: Record<string, unknown> = {};

    if (body.timezone !== undefined) {
      const tz = String(body.timezone).trim();
      if (!isValidTimezone(tz)) {
        return NextResponse.json(
          { error: 'timezone must be a valid IANA timezone identifier' },
          { status: 400 },
        );
      }
      update.timezone = tz;
    }

    if (body.business_hours !== undefined) {
      if (!body.business_hours || typeof body.business_hours !== 'object') {
        return NextResponse.json({ error: 'business_hours must be an object' }, { status: 400 });
      }
      const hours = body.business_hours as Record<string, unknown>;
      const normalized: Record<Day, { open: string; close: string; closed: boolean }> = {} as Record<Day, { open: string; close: string; closed: boolean }>;
      for (const day of DAYS) {
        const entry = hours[day] as { open?: unknown; close?: unknown; closed?: unknown } | undefined;
        if (!entry || typeof entry !== 'object') {
          return NextResponse.json(
            { error: `business_hours.${day} is required` },
            { status: 400 },
          );
        }
        if (!isValidTime(entry.open) || !isValidTime(entry.close)) {
          return NextResponse.json(
            { error: `business_hours.${day}.open/close must be HH:MM (24h)` },
            { status: 400 },
          );
        }
        normalized[day] = {
          open: entry.open as string,
          close: entry.close as string,
          closed: Boolean(entry.closed),
        };
      }
      update.business_hours = normalized;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('organizations').update(update).eq('id', orgId);
    if (error) {
      return NextResponse.json(
        { error: 'Failed to update business hours', details: error.message },
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
