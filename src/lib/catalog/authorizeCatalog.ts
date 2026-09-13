import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireManagerPermission } from '@/lib/auth/requireManagerPermission';
import { isUuid } from './parse';
import { resolveChecklistOrg, resolveLineItemOrg, resolveServiceOrg } from './resolveCatalogOrg';

/**
 * Catalog authorizers: resolve the org that owns a service (PR B: a checklist,
 * a line item), then run the manager-flag check against THAT org. A missing or
 * malformed id is a 404 before any token check; catalog ids are unguessable
 * UUIDs and the 404 body carries nothing else.
 */
export type CatalogAuth<T> =
  | ({ ok: true; userId: string } & T)
  | { ok: false; response: NextResponse };

export const FLAG = 'can_manage_services' as const;
export const MESSAGE = 'Requires the Manage services permission';
export const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 });

export async function authorizeService(
  request: NextRequest,
  serviceId: string,
): Promise<CatalogAuth<{ organizationId: string }>> {
  if (!isUuid(serviceId)) return { ok: false, response: notFound('Service') };
  const target = await resolveServiceOrg(supabaseAdmin, serviceId);
  if (!target) return { ok: false, response: notFound('Service') };
  const auth = await requireManagerPermission(request, target.organizationId, supabaseAdmin, FLAG, {
    errorMessage: MESSAGE,
    requireWritable: true,
  });
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId, organizationId: target.organizationId };
}

export async function authorizeChecklist(
  request: NextRequest,
  checklistId: string,
): Promise<CatalogAuth<{ organizationId: string; serviceTypeId: string }>> {
  if (!isUuid(checklistId)) return { ok: false, response: notFound('Checklist') };
  const target = await resolveChecklistOrg(supabaseAdmin, checklistId);
  if (!target) return { ok: false, response: notFound('Checklist') };
  const auth = await requireManagerPermission(request, target.organizationId, supabaseAdmin, FLAG, {
    errorMessage: MESSAGE,
    requireWritable: true,
  });
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId, ...target };
}

export async function authorizeLineItem(
  request: NextRequest,
  itemId: string,
): Promise<CatalogAuth<{ organizationId: string; serviceTypeId: string; checklistId: string }>> {
  if (!isUuid(itemId)) return { ok: false, response: notFound('Task') };
  const target = await resolveLineItemOrg(supabaseAdmin, itemId);
  if (!target) return { ok: false, response: notFound('Task') };
  const auth = await requireManagerPermission(request, target.organizationId, supabaseAdmin, FLAG, {
    errorMessage: MESSAGE,
    requireWritable: true,
  });
  if (!auth.ok) return auth;
  return { ok: true, userId: auth.userId, ...target };
}
