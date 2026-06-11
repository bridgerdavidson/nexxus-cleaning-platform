/**
 * Resolves the customer label shown on a calendar event. Fixes the old calendar's "Unknown":
 * org-owned / self-pay properties have no homeowner, so we fall back to the property name or
 * address, never the literal "Unknown".
 */
interface NameInput {
  homeowner?: { first_name?: string | null; last_name?: string | null } | null;
  is_self_pay?: boolean | null;
  property?: { name?: string | null; address?: string | null } | null;
}

export function resolveCustomerLabel(apt: NameInput, role?: string): string {
  const propertyLabel = apt.property?.name?.trim() || apt.property?.address?.trim() || '';

  // The homeowner sees their own property, not their own name.
  if (role === 'homeowner') {
    return propertyLabel || 'Your property';
  }

  const fullName = `${apt.homeowner?.first_name ?? ''} ${apt.homeowner?.last_name ?? ''}`.trim();
  if (fullName) return fullName;

  if (apt.is_self_pay) return propertyLabel || 'Company booking';
  if (propertyLabel) return propertyLabel;
  return 'Customer';
}
