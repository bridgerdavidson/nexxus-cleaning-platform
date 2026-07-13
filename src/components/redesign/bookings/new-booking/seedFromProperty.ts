import type { AdminProperty } from '@/hooks/useAdminData';
import type { NewBookingSeed } from './useOpenOperatorBooking';

/**
 * Seeds the operator new-booking sheet from a property row's "Book" action.
 * A homeowner-owned property has a customer to bill, so it prefills both the
 * customer and the property with `billTo: 'customer'`. An org-owned property
 * (`owner_id` null) has no customer to bill, so it prefills only the property
 * with `billTo: 'self_pay'` ("Company pays") and omits `customerId` entirely.
 */
export function buildPropertySeed(p: AdminProperty): NewBookingSeed {
  if (p.owner_id) return { customerId: p.owner_id, propertyId: p.id, billTo: 'customer' };
  return { propertyId: p.id, billTo: 'self_pay' };
}
