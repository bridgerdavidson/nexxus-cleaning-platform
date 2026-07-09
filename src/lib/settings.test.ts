import { describe, it, expect } from 'vitest';
import {
  getSectionsForRole,
  sectionVisibleToRole,
  defaultSectionForRole,
} from './settings';

const FULL_MANAGER_PERMS = {
  can_view_customers: true,
  can_edit_customers: true,
  can_view_bookings: true,
  can_edit_bookings: true,
  can_manage_cleaners: true,
  can_view_properties: true,
  can_edit_properties: true,
  can_view_analytics: true,
  can_view_payments: true,
  can_manage_payments: true,
  can_view_messages: true,
  can_view_services: true,
  can_manage_services: true,
  can_handle_requests: true,
};

describe('getSectionsForRole', () => {
  it('homeowner sees only Account-group sections', () => {
    const ids = getSectionsForRole('homeowner', 'homeowner').map((s) => s.id);
    expect(ids).toEqual(['profile', 'security', 'notifications']);
  });

  it('cleaner adds Payouts under Earnings group', () => {
    const sections = getSectionsForRole('cleaner', 'cleaner');
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('payouts');
    expect(ids).not.toContain('payments');
    expect(sections.find((s) => s.id === 'payouts')?.group).toBe('earnings');
  });

  it('owner sees Payments and Cancellation policy', () => {
    const ids = getSectionsForRole('admin', 'owner').map((s) => s.id);
    expect(ids).toContain('payments');
    expect(ids).toContain('cancellation-policy');
    expect(ids).not.toContain('payouts');
  });

  it('admin sees Payments and Cancellation policy (org role admin)', () => {
    const ids = getSectionsForRole('admin', 'admin').map((s) => s.id);
    expect(ids).toContain('payments');
    expect(ids).toContain('cancellation-policy');
  });

  it('manager WITHOUT can_manage_payments hides Payments + Cancellation policy', () => {
    const ids = getSectionsForRole('manager', 'manager', {
      ...FULL_MANAGER_PERMS,
      can_manage_payments: false,
    }).map((s) => s.id);
    expect(ids).not.toContain('payments');
    expect(ids).not.toContain('cancellation-policy');
    expect(ids).toContain('profile');
  });

  it('manager WITH can_manage_payments sees Payments + Cancellation policy', () => {
    const ids = getSectionsForRole('manager', 'manager', FULL_MANAGER_PERMS).map(
      (s) => s.id,
    );
    expect(ids).toContain('payments');
    expect(ids).toContain('cancellation-policy');
  });

  it('every section has an href that starts with /settings/', () => {
    const sections = getSectionsForRole('admin', 'owner');
    for (const s of sections) {
      expect(s.href).toMatch(/^\/settings\//);
    }
  });
});

describe('sectionVisibleToRole', () => {
  it('owner can see Payments', () => {
    expect(sectionVisibleToRole('payments', 'admin', 'owner')).toBe(true);
  });

  it('cleaner cannot see Payments', () => {
    expect(sectionVisibleToRole('payments', 'cleaner', 'cleaner')).toBe(false);
  });

  it('homeowner cannot see Payouts', () => {
    expect(sectionVisibleToRole('payouts', 'homeowner', 'homeowner')).toBe(false);
  });

  it('cleaner can see Payouts', () => {
    expect(sectionVisibleToRole('payouts', 'cleaner', 'cleaner')).toBe(true);
  });

  it('manager without can_manage_payments cannot see Cancellation policy', () => {
    expect(
      sectionVisibleToRole('cancellation-policy', 'manager', 'manager', {
        ...FULL_MANAGER_PERMS,
        can_manage_payments: false,
      }),
    ).toBe(false);
  });
});

describe('defaultSectionForRole', () => {
  it('owner lands on payments', () => {
    expect(defaultSectionForRole('admin', 'owner')).toBe('payments');
  });
  it('admin lands on payments', () => {
    expect(defaultSectionForRole('admin', 'admin')).toBe('payments');
  });
  it('cleaner lands on payouts', () => {
    expect(defaultSectionForRole('cleaner', 'cleaner')).toBe('payouts');
  });
  it('homeowner lands on profile', () => {
    expect(defaultSectionForRole('homeowner', 'homeowner')).toBe('profile');
  });
  it('falls back to profile when role is missing', () => {
    expect(defaultSectionForRole()).toBe('profile');
  });
});
