import { describe, it, expect } from 'vitest';
import { OPERATOR_NAV, filterOperatorNav } from './nav-items';
import { emptyManagerPermissions } from '@/lib/permissions/managerFlags';

describe('filterOperatorNav', () => {
  it('privileged sees everything', () => {
    const out = filterOperatorNav(OPERATOR_NAV, { privileged: true, permissions: null });
    expect(out).toHaveLength(OPERATOR_NAV.length);
  });
  it('a manager with no flags sees only overview + settings', () => {
    const out = filterOperatorNav(OPERATOR_NAV, { privileged: false, permissions: emptyManagerPermissions() });
    expect(out.map((i) => i.id).sort()).toEqual(['overview', 'settings']);
  });
  it('a flag reveals its destination', () => {
    const perms = { ...emptyManagerPermissions(), can_view_payments: true };
    const out = filterOperatorNav(OPERATOR_NAV, { privileged: false, permissions: perms });
    expect(out.map((i) => i.id)).toContain('payments');
    expect(out.map((i) => i.id)).not.toContain('analytics');
  });
  it('can_view_properties reveals the properties destination', () => {
    const perms = { ...emptyManagerPermissions(), can_view_properties: true };
    const out = filterOperatorNav(OPERATOR_NAV, { privileged: false, permissions: perms });
    expect(out.map((i) => i.id)).toContain('properties');
    expect(out.map((i) => i.id)).not.toContain('payments');
  });
});
