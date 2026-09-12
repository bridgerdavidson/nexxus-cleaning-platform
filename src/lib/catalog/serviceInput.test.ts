import { describe, it, expect } from 'vitest';
import { parseChecklistSeeds, parseServiceCreate, parseServiceUpdate } from './serviceInput';

const ORG = '5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
const valid = {
  organization_id: ORG,
  name: ' Deep Clean ',
  description: ' Top to bottom ',
  base_price: '199.5',
  duration_minutes: 180,
  service_type: 'deep',
};

describe('parseServiceCreate', () => {
  it('normalizes a valid body and defaults is_active to true', () => {
    expect(parseServiceCreate(valid)).toEqual({
      ok: true,
      value: {
        organization_id: ORG,
        name: 'Deep Clean',
        description: 'Top to bottom',
        base_price: 199.5,
        duration_minutes: 180,
        service_type: 'deep',
        is_active: true,
      },
    });
  });

  it('leaves checklists undefined when the key is absent', () => {
    const r = parseServiceCreate(valid);
    expect(r.ok && 'checklists' in r.value).toBe(false);
  });

  it('keeps an empty checklists array as an empty array', () => {
    const r = parseServiceCreate({ ...valid, checklists: [] });
    expect(r).toMatchObject({ ok: true, value: { checklists: [] } });
  });

  it('rejects a missing org id, blank name, bad price, bad duration, bad type, bad is_active', () => {
    expect(parseServiceCreate({ ...valid, organization_id: 'nope' })).toEqual({ ok: false, error: 'organization_id is required' });
    expect(parseServiceCreate({ ...valid, name: '' })).toEqual({ ok: false, error: 'Service name is required' });
    expect(parseServiceCreate({ ...valid, base_price: -5 })).toEqual({ ok: false, error: 'Base price must be a number of 0 or more' });
    expect(parseServiceCreate({ ...valid, duration_minutes: 0 })).toEqual({ ok: false, error: 'Duration must be a whole number of minutes greater than 0' });
    expect(parseServiceCreate({ ...valid, duration_minutes: 90.5 })).toEqual({ ok: false, error: 'Duration must be a whole number of minutes greater than 0' });
    expect(parseServiceCreate({ ...valid, service_type: '' })).toEqual({ ok: false, error: 'Service type is required' });
    expect(parseServiceCreate({ ...valid, is_active: 'yes' })).toEqual({ ok: false, error: 'is_active must be true or false' });
    expect(parseServiceCreate(null)).toEqual({ ok: false, error: 'Request body must be a JSON object' });
  });
});

describe('parseChecklistSeeds', () => {
  it('trims tasks, drops blank tasks, defaults name and price and position', () => {
    expect(parseChecklistSeeds([{ items: [' Dust ', '', 'Vacuum'] }])).toEqual({
      ok: true,
      value: [{ name: 'New Checklist', price_adder: 0, position: null, items: ['Dust', 'Vacuum'] }],
    });
  });
  it('keeps an explicit name, price and position', () => {
    expect(parseChecklistSeeds([{ name: ' Plus ', price_adder: '25', position: 1, items: [] }])).toEqual({
      ok: true,
      value: [{ name: 'Plus', price_adder: 25, position: 1, items: [] }],
    });
  });
  it('rejects a non-array, a non-object entry, a bad price, a bad position, and non-text items', () => {
    expect(parseChecklistSeeds({})).toEqual({ ok: false, error: 'checklists must be an array' });
    expect(parseChecklistSeeds(['x'])).toEqual({ ok: false, error: 'Each checklist must be an object' });
    expect(parseChecklistSeeds([{ price_adder: -1 }])).toEqual({ ok: false, error: 'Checklist price must be a number of 0 or more' });
    expect(parseChecklistSeeds([{ position: 1.5 }])).toEqual({ ok: false, error: 'Checklist position must be a whole number' });
    expect(parseChecklistSeeds([{ items: [1] }])).toEqual({ ok: false, error: 'Checklist items must be text' });
  });
});

describe('parseServiceUpdate', () => {
  it('accepts any subset of fields and normalizes them', () => {
    expect(parseServiceUpdate({ name: ' Basic ', is_active: false })).toEqual({
      ok: true,
      value: { name: 'Basic', is_active: false },
    });
    expect(parseServiceUpdate({ description: '' })).toEqual({ ok: true, value: { description: null } });
  });
  it('rejects an empty update and invalid values', () => {
    expect(parseServiceUpdate({})).toEqual({ ok: false, error: 'No valid fields to update' });
    expect(parseServiceUpdate({ unrelated: 1 })).toEqual({ ok: false, error: 'No valid fields to update' });
    expect(parseServiceUpdate({ name: '  ' })).toEqual({ ok: false, error: 'Service name is required' });
    expect(parseServiceUpdate({ base_price: 'x' })).toEqual({ ok: false, error: 'Base price must be a number of 0 or more' });
  });
});
