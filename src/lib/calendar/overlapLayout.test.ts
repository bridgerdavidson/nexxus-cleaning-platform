import { describe, it, expect } from 'vitest';
import { packEventsIntoLanes } from './overlapLayout';

const ev = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });
const byId = (rows: Array<{ id: string; lane: number; laneCount: number }>) =>
  Object.fromEntries(rows.map((r) => [r.id, { lane: r.lane, laneCount: r.laneCount }]));

describe('packEventsIntoLanes', () => {
  it('returns [] for no events', () => {
    expect(packEventsIntoLanes([])).toEqual([]);
  });

  it('gives a lone event the full width', () => {
    const [a] = packEventsIntoLanes([ev('a', 540, 600)]);
    expect(a).toMatchObject({ id: 'a', lane: 0, laneCount: 1 });
  });

  it('splits two overlapping events into two lanes', () => {
    const m = byId(packEventsIntoLanes([ev('a', 540, 600), ev('b', 570, 630)]));
    expect(m.a).toEqual({ lane: 0, laneCount: 2 });
    expect(m.b).toEqual({ lane: 1, laneCount: 2 });
  });

  it('treats back-to-back events as non-overlapping (full width, separate clusters)', () => {
    const m = byId(packEventsIntoLanes([ev('a', 540, 600), ev('b', 600, 660)]));
    expect(m.a).toEqual({ lane: 0, laneCount: 1 });
    expect(m.b).toEqual({ lane: 0, laneCount: 1 });
  });

  it('packs a 3-way pile-up into 3 lanes', () => {
    const m = byId(packEventsIntoLanes([ev('a', 540, 660), ev('b', 555, 615), ev('c', 600, 720)]));
    expect(m.a.laneCount).toBe(3);
    expect(m.b.laneCount).toBe(3);
    expect(m.c.laneCount).toBe(3);
    expect(new Set([m.a.lane, m.b.lane, m.c.lane])).toEqual(new Set([0, 1, 2]));
  });

  it('keeps a chain (A-B overlap, B-C overlap, A-C do not) at the densest lane count', () => {
    // A 540-600, B 570-630, C 610-680. A and C never overlap, so C reuses lane 0.
    const m = byId(packEventsIntoLanes([ev('a', 540, 600), ev('b', 570, 630), ev('c', 610, 680)]));
    expect(m.a).toEqual({ lane: 0, laneCount: 2 });
    expect(m.b).toEqual({ lane: 1, laneCount: 2 });
    expect(m.c).toEqual({ lane: 0, laneCount: 2 });
  });

  it('preserves the original item fields', () => {
    const [a] = packEventsIntoLanes([{ id: 'a', startMin: 540, endMin: 600, extra: 'keep' }]);
    expect(a.extra).toBe('keep');
  });
});
