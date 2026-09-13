import { describe, it, expect } from 'vitest';
import {
  orderMatchesItems,
  parseChecklistCreate,
  parseChecklistUpdate,
  parseItemUpdate,
  parseItemsCreate,
  parseOrder,
} from './checklistInput';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('parseChecklistCreate', () => {
  it('defaults name, price and items', () => {
    expect(parseChecklistCreate({})).toEqual({ ok: true, value: { name: 'New Checklist', price_adder: 0, items: [] } });
    expect(parseChecklistCreate({ name: '  ' })).toEqual({ ok: true, value: { name: 'New Checklist', price_adder: 0, items: [] } });
  });
  it('trims name and items, drops blank items, parses price strings', () => {
    expect(parseChecklistCreate({ name: ' Plus ', price_adder: '25', items: [' Dust ', '', 'Mop'] })).toEqual({
      ok: true,
      value: { name: 'Plus', price_adder: 25, items: ['Dust', 'Mop'] },
    });
  });
  it('rejects a bad price, non-text items, an over-long name, and a non-object body', () => {
    expect(parseChecklistCreate({ price_adder: -1 })).toEqual({ ok: false, error: 'Checklist price must be a number of 0 or more' });
    expect(parseChecklistCreate({ items: [1] })).toEqual({ ok: false, error: 'Checklist items must be text' });
    expect(parseChecklistCreate({ name: 'x'.repeat(121) })).toEqual({ ok: false, error: 'Checklist name must be 120 characters or fewer' });
    expect(parseChecklistCreate([])).toEqual({ ok: false, error: 'Request body must be a JSON object' });
  });
});

describe('parseChecklistUpdate', () => {
  it('accepts either field', () => {
    expect(parseChecklistUpdate({ name: ' Basic ' })).toEqual({ ok: true, value: { name: 'Basic' } });
    expect(parseChecklistUpdate({ price_adder: 10 })).toEqual({ ok: true, value: { price_adder: 10 } });
    expect(parseChecklistUpdate({ name: 'Basic', price_adder: '10' })).toEqual({ ok: true, value: { name: 'Basic', price_adder: 10 } });
  });
  it('rejects a blank name with the message the page already shows, and an empty update', () => {
    expect(parseChecklistUpdate({ name: '  ' })).toEqual({ ok: false, error: 'Checklist name cannot be empty' });
    expect(parseChecklistUpdate({})).toEqual({ ok: false, error: 'No valid fields to update' });
  });
});

describe('parseItemsCreate', () => {
  it('accepts a single task', () => {
    expect(parseItemsCreate({ task: ' Dust ' })).toEqual({ ok: true, value: { tasks: ['Dust'] } });
  });
  it('accepts many tasks, trimmed, blanks dropped', () => {
    expect(parseItemsCreate({ tasks: [' Dust ', '', 'Mop'] })).toEqual({ ok: true, value: { tasks: ['Dust', 'Mop'] } });
  });
  it('rejects a blank single task, an empty list, and non-text', () => {
    expect(parseItemsCreate({ task: '  ' })).toEqual({ ok: false, error: 'Task cannot be empty' });
    expect(parseItemsCreate({})).toEqual({ ok: false, error: 'Task cannot be empty' });
    expect(parseItemsCreate({ tasks: ['', ' '] })).toEqual({ ok: false, error: 'No tasks to add' });
    expect(parseItemsCreate({ tasks: 'Dust' })).toEqual({ ok: false, error: 'Checklist items must be text' });
  });
});

describe('parseItemUpdate', () => {
  it('trims the task and rejects blank', () => {
    expect(parseItemUpdate({ task: ' Mop ' })).toEqual({ ok: true, value: { task: 'Mop' } });
    expect(parseItemUpdate({ task: '' })).toEqual({ ok: false, error: 'Task cannot be empty' });
    expect(parseItemUpdate({})).toEqual({ ok: false, error: 'Task cannot be empty' });
  });
});

describe('parseOrder', () => {
  it('accepts a list of unique ids', () => {
    expect(parseOrder({ item_ids: [B, A] })).toEqual({ ok: true, value: { item_ids: [B, A] } });
  });
  it('rejects empty, non-uuid, and duplicate lists', () => {
    const err = { ok: false, error: 'item_ids must be a list of unique item ids' };
    expect(parseOrder({ item_ids: [] })).toEqual(err);
    expect(parseOrder({ item_ids: ['x'] })).toEqual(err);
    expect(parseOrder({ item_ids: [A, A] })).toEqual(err);
    expect(parseOrder({})).toEqual(err);
  });
});

describe('orderMatchesItems', () => {
  it('is true only when both lists hold the same ids', () => {
    expect(orderMatchesItems([C, A, B], [A, B, C])).toBe(true);
    expect(orderMatchesItems([A, B], [A, B, C])).toBe(false);
    expect(orderMatchesItems([A, B, C], [A, B])).toBe(false);
    expect(orderMatchesItems([A, B, '44444444-4444-4444-8444-444444444444'], [A, B, C])).toBe(false);
  });
});
