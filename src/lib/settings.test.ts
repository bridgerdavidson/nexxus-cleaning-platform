import { describe, it, expect } from 'vitest';
import { getSectionsForRole } from './settings';

const ids = (role?: string, orgRole?: string) => getSectionsForRole(role, orgRole).map((s) => s.id);

describe('getSectionsForRole', () => {
  it('shows only role-agnostic sections when no role is given', () => {
    const out = ids();
    expect(out).toEqual(expect.arrayContaining(['profile', 'security', 'notifications']));
    expect(out).not.toContain('billing');
    expect(out).not.toContain('payouts');
  });

  it('shows the Payments section to a UserRole admin', () => {
    expect(ids('admin')).toContain('billing');
  });

  it('hides Payments from a plain cleaner (but shows Payouts)', () => {
    expect(ids('cleaner')).not.toContain('billing');
    expect(ids('cleaner')).toContain('payouts');
  });

  it('shows Payments to an org owner/admin even when the UserRole is not admin (OrgRole match)', () => {
    expect(ids('manager', 'owner')).toContain('billing');
    expect(ids('manager', 'admin')).toContain('billing');
  });

  it('OrgRole matching is additive — it never hides a UserRole-gated section', () => {
    expect(ids('cleaner', 'cleaner')).toContain('payouts');
  });
});
