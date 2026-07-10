import { describe, expect, it } from 'vitest';
import { nowLineY } from './nowLine';

const hours = { startMin: 420, endMin: 1140 }; // 7:00-19:00
// A fixed instant at local 13:00 on 2026-07-10.
const noon13 = new Date(2026, 6, 10, 13, 0).getTime();

describe('nowLineY', () => {
  it('returns a positive offset when now is today and inside the window', () => {
    // 13:00 = 780min; (780-420)*0.8 = 288
    expect(nowLineY(noon13, '2026-07-10', hours)).toBeCloseTo(288);
  });
  it('returns null when the focused day is not today', () => {
    expect(nowLineY(noon13, '2026-07-11', hours)).toBeNull();
  });
  it('returns null when now is outside the window', () => {
    const t6am = new Date(2026, 6, 10, 6, 0).getTime();
    expect(nowLineY(t6am, '2026-07-10', hours)).toBeNull();
  });
});
