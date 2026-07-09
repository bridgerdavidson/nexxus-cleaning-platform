import { describe, it, expect } from 'vitest';
import {
  MANAGER_FLAG_KEYS,
  MANAGER_FLAGS,
  MANAGER_FLAG_GROUPS,
  STANDARD_MANAGER_PRESET,
  emptyManagerPermissions,
  coerceManagerPermissions,
} from './managerFlags';

describe('managerFlags registry', () => {
  it('has exactly 14 flags with no duplicates and no removed flag', () => {
    expect(MANAGER_FLAG_KEYS).toHaveLength(14);
    expect(new Set(MANAGER_FLAG_KEYS).size).toBe(14);
    expect(MANAGER_FLAG_KEYS).not.toContain('can_approve_decline_bookings');
    expect(MANAGER_FLAG_KEYS).toContain('can_handle_requests');
  });

  it('every flag has a definition with a known group', () => {
    for (const key of MANAGER_FLAG_KEYS) {
      const def = MANAGER_FLAGS.find((f) => f.key === key);
      expect(def, `missing def for ${key}`).toBeTruthy();
      expect(MANAGER_FLAG_GROUPS).toContain(def!.group);
    }
  });

  it('emptyManagerPermissions is all false', () => {
    const empty = emptyManagerPermissions();
    expect(Object.values(empty).every((v) => v === false)).toBe(true);
    expect(Object.keys(empty).sort()).toEqual([...MANAGER_FLAG_KEYS].sort());
  });

  it('STANDARD_MANAGER_PRESET has 9 on / 5 off with the sensitive flags off', () => {
    const on = MANAGER_FLAG_KEYS.filter((k) => STANDARD_MANAGER_PRESET[k]);
    expect(on).toHaveLength(9);
    for (const off of ['can_edit_properties', 'can_manage_services', 'can_view_payments', 'can_manage_payments', 'can_manage_cleaners'] as const) {
      expect(STANDARD_MANAGER_PRESET[off]).toBe(false);
    }
  });

  it('coerceManagerPermissions defaults missing/falsey keys to false', () => {
    const p = coerceManagerPermissions({ can_view_bookings: true, can_edit_bookings: 1 as unknown });
    expect(p.can_view_bookings).toBe(true);
    expect(p.can_edit_bookings).toBe(true);
    expect(p.can_manage_payments).toBe(false);
  });
});
