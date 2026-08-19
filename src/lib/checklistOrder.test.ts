import { describe, it, expect } from 'vitest';
import { compareChecklists } from './checklistOrder';

describe('compareChecklists', () => {
  it('orders by price_adder ascending (cheapest tier first)', () => {
    const tiers = [
      { id: 'deep', price_adder: 40, created_at: '2026-01-01T00:00:00Z' },
      { id: 'basic', price_adder: 0, created_at: '2026-03-01T00:00:00Z' },
      { id: 'plus', price_adder: 20, created_at: '2026-02-01T00:00:00Z' },
    ];
    expect([...tiers].sort(compareChecklists).map((t) => t.id)).toEqual(['basic', 'plus', 'deep']);
  });

  it('breaks price ties by creation order, not name', () => {
    const tiers = [
      { id: 'z-newer', price_adder: 0, created_at: '2026-02-01T00:00:00Z' },
      { id: 'a-older', price_adder: 0, created_at: '2026-01-01T00:00:00Z' },
    ];
    expect([...tiers].sort(compareChecklists).map((t) => t.id)).toEqual(['a-older', 'z-newer']);
  });

  it('is stable under renames and repricing to the same value: identical keys fall back to id', () => {
    const tiers = [
      { id: 'b', price_adder: 10, created_at: '2026-01-01T00:00:00Z' },
      { id: 'a', price_adder: 10, created_at: '2026-01-01T00:00:00Z' },
    ];
    expect([...tiers].sort(compareChecklists).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('tolerates numeric strings and missing values (Postgres numeric, legacy rows)', () => {
    const tiers = [
      { id: 'stringy', price_adder: '15.50' as unknown as number, created_at: '2026-01-01T00:00:00Z' },
      { id: 'nullish', price_adder: null, created_at: null },
    ];
    expect([...tiers].sort(compareChecklists).map((t) => t.id)).toEqual(['nullish', 'stringy']);
  });
});
