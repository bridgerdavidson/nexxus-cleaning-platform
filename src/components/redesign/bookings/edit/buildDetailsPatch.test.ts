import { describe, it, expect } from 'vitest';
import { buildDetailsPatch, editDetailsPriceError, isPriceAffectingEdit } from './buildDetailsPatch';
import type { EditDetailsState } from './seedEditDetails';

function mkState(overrides: Partial<EditDetailsState> = {}): EditDetailsState {
  return {
    serviceTypeId: 'svc-1',
    checklistId: 'chk-1',
    overrideEnabled: false,
    overrideTotal: null,
    specialRequests: '',
    notes: '',
    ...overrides,
  };
}

describe('buildDetailsPatch', () => {
  it('trims requests/notes to null and nulls the override total when disabled', () => {
    const body = buildDetailsPatch(
      mkState({
        specialRequests: '   ',
        notes: '  \n  ',
        overrideEnabled: false,
        overrideTotal: 999, // stale leftover value; must not leak through when disabled
      }),
    );
    expect(body).toMatchObject({
      specialRequests: null,
      notes: null,
      priceOverrideEnabled: false,
      priceOverrideTotal: null,
    });
  });

  it('trims non-empty whitespace-padded text', () => {
    const body = buildDetailsPatch(mkState({ specialRequests: '  side gate  ', notes: '  gate code  ' }));
    expect(body.specialRequests).toBe('side gate');
    expect(body.notes).toBe('gate code');
  });

  it('passes the override total through when enabled', () => {
    const body = buildDetailsPatch(mkState({ overrideEnabled: true, overrideTotal: 175 }));
    expect(body).toMatchObject({ priceOverrideEnabled: true, priceOverrideTotal: 175 });
  });

  it('passes service and checklist ids through, nulling a cleared checklist', () => {
    const body = buildDetailsPatch(mkState({ serviceTypeId: 'svc-2', checklistId: null }));
    expect(body).toMatchObject({ serviceTypeId: 'svc-2', checklistId: null });
  });

  it('throws when no service is selected', () => {
    expect(() => buildDetailsPatch(mkState({ serviceTypeId: null }))).toThrow();
  });
});

describe('isPriceAffectingEdit', () => {
  const initial = mkState({ overrideEnabled: true, overrideTotal: 120 });

  it('is false for a notes or requests only edit', () => {
    expect(isPriceAffectingEdit(initial, { ...initial, notes: 'gate code', specialRequests: 'dog' })).toBe(false);
  });

  it('is true when the service, checklist, or override changes', () => {
    expect(isPriceAffectingEdit(initial, { ...initial, serviceTypeId: 'svc-2' })).toBe(true);
    expect(isPriceAffectingEdit(initial, { ...initial, checklistId: null })).toBe(true);
    expect(isPriceAffectingEdit(initial, { ...initial, overrideEnabled: false, overrideTotal: null })).toBe(true);
    expect(isPriceAffectingEdit(initial, { ...initial, overrideTotal: 130 })).toBe(true);
  });
});

describe('editDetailsPriceError (minimum job price $1)', () => {
  const MSG = 'Price must be at least $1.';

  it('never blocks a notes-only save, even on a legacy $0 booking', () => {
    const legacy = mkState();
    expect(editDetailsPriceError(legacy, { ...legacy, notes: 'unrelated' }, 0)).toBeNull();
  });

  it('blocks an override under $1', () => {
    const initial = mkState();
    expect(editDetailsPriceError(initial, { ...initial, overrideEnabled: true, overrideTotal: 0.5 }, 150)).toBe(MSG);
    expect(editDetailsPriceError(initial, { ...initial, overrideEnabled: true, overrideTotal: 0 }, 150)).toBe(MSG);
  });

  it('blocks switching to a service whose system total is under $1', () => {
    const initial = mkState();
    expect(editDetailsPriceError(initial, { ...initial, serviceTypeId: 'svc-zero', checklistId: null }, 0)).toBe(MSG);
  });

  it('blocks resetting an override when the system total is under $1', () => {
    const initial = mkState({ overrideEnabled: true, overrideTotal: 150 });
    expect(editDetailsPriceError(initial, { ...initial, overrideEnabled: false, overrideTotal: null }, 0)).toBe(MSG);
  });

  it('allows exactly $1 and ordinary prices', () => {
    const initial = mkState();
    expect(editDetailsPriceError(initial, { ...initial, overrideEnabled: true, overrideTotal: 1 }, 0)).toBeNull();
    expect(editDetailsPriceError(initial, { ...initial, serviceTypeId: 'svc-2' }, 180)).toBeNull();
  });
});
