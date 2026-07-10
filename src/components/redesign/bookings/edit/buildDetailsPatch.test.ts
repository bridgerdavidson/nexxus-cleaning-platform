import { describe, it, expect } from 'vitest';
import { buildDetailsPatch } from './buildDetailsPatch';
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
