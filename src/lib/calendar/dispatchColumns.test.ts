import { describe, it, expect } from 'vitest';
import { buildCleanerColumns } from './dispatchColumns';

const cleaners = [
  { id: 'c1', name: 'Wanda' },
  { id: 'c2', name: 'Jordan' },
];
const ev = (id: string, cleanerId: string | null, cleanerName?: string | null) => ({
  id,
  cleanerId,
  cleanerName,
});

describe('buildCleanerColumns', () => {
  it('groups events by cleaner in roster order, empty columns included', () => {
    const cols = buildCleanerColumns([ev('a', 'c1'), ev('b', 'c1')], cleaners);
    expect(cols.map((c) => c.cleaner?.id)).toEqual(['c1', 'c2']);
    expect(cols[0].events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(cols[1].events).toEqual([]);
  });

  it('appends an Unassigned column when events have no cleaner', () => {
    const cols = buildCleanerColumns([ev('a', 'c1'), ev('u', null)], cleaners);
    const last = cols[cols.length - 1];
    expect(last.cleaner).toBeNull();
    expect(last.events.map((e) => e.id)).toEqual(['u']);
  });

  it('keeps events whose cleaner is missing from the roster', () => {
    const cols = buildCleanerColumns([ev('x', 'ghost', 'Old Cleaner')], cleaners);
    const ghost = cols.find((c) => c.cleaner?.id === 'ghost');
    expect(ghost?.cleaner?.name).toBe('Old Cleaner');
    expect(ghost?.events.map((e) => e.id)).toEqual(['x']);
  });

  it('handles an empty roster with only unassigned events', () => {
    const cols = buildCleanerColumns([ev('u', null)], []);
    expect(cols).toHaveLength(1);
    expect(cols[0].cleaner).toBeNull();
  });
});
