// Task 12: the "eight triggers, one host" gate. Every test below maps to a
// specific way this can fail: the sheet opening while frozen (a mutation
// found during this PR: a control that stayed "live" no matter what
// useBilling() said), the wall opening for a non-owner (dead per paywallGate,
// paywallModel.ts:100, since isOwner is a hard condition there), or the flag
// being ignored so a flag-dark org gets gated anyway. This repo has no
// component-rendering setup and @testing-library/react is not installed, so
// OperatorBookingHost.tsx cannot be mounted; the wiring block at the bottom
// statically scans its source instead.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { bookingHostGate, type BookingHostGateInput } from './operatorBookingHostModel';

function input(over: Partial<BookingHostGateInput> = {}): BookingHostGateInput {
  return { paramPresent: true, uiEnabled: true, frozen: false, isOwner: true, ...over };
}

describe('bookingHostGate', () => {
  it('renders nothing at all when the param is absent, regardless of billing state', () => {
    expect(bookingHostGate(input({ paramPresent: false, frozen: true, isOwner: true }))).toEqual({
      showSheet: false,
      openWall: false,
      clearParam: false,
    });
  });

  it('shows the sheet normally when not frozen', () => {
    expect(bookingHostGate(input({ frozen: false }))).toEqual({
      showSheet: true,
      openWall: false,
      clearParam: false,
    });
  });

  // THE mutation target: the sheet must never render while the org is
  // frozen, for any role. A mutant that drops this check (or inverts it)
  // ships a "new booking" form a frozen org can still submit into a 402.
  it('never shows the sheet while frozen, for the owner', () => {
    const result = bookingHostGate(input({ frozen: true, isOwner: true }));
    expect(result.showSheet).toBe(false);
  });

  it('never shows the sheet while frozen, for a non-owner', () => {
    const result = bookingHostGate(input({ frozen: true, isOwner: false }));
    expect(result.showSheet).toBe(false);
  });

  it('opens the wall when frozen and the viewer is the owner', () => {
    expect(bookingHostGate(input({ frozen: true, isOwner: true }))).toEqual({
      showSheet: false,
      openWall: true,
      clearParam: true,
    });
  });

  // Ruling R2 / paywallGate (paywallModel.ts:100): the wall only ever
  // renders for isOwner. Calling openPaywall() for a non-owner would be a
  // silent no-op downstream, but the correct behaviour is not to call it at
  // all, so this is asserted directly rather than trusted to the gate below.
  it('does not open the wall for a non-owner when frozen (their click is a no-op)', () => {
    const result = bookingHostGate(input({ frozen: true, isOwner: false }));
    expect(result.openWall).toBe(false);
    // The param still clears: a non-owner must not leave ?newbooking=1
    // sitting in the URL with nothing rendering for it.
    expect(result.clearParam).toBe(true);
  });

  // Mutation target: ignoring uiEnabled and gating on frozen alone would
  // block "new work" clicks on a flag-dark org, before ops has ever turned
  // billing enforcement on.
  it('shows the sheet when the org would be frozen but the flag is off', () => {
    expect(bookingHostGate(input({ uiEnabled: false, frozen: true, isOwner: true }))).toEqual({
      showSheet: true,
      openWall: false,
      clearParam: false,
    });
  });

  it('does not clear the param when the sheet is shown normally', () => {
    const result = bookingHostGate(input({ frozen: false }));
    expect(result.clearParam).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wiring: OperatorBookingHost.tsx cannot be mounted (no component-rendering
// setup, no @testing-library/react by standing decision). These static
// checks are the only guard that the renderer actually calls bookingHostGate
// and honours its result, rather than rendering the sheet off the raw param.
// ---------------------------------------------------------------------------

/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('OperatorBookingHost wiring', () => {
  const source = readFileSync(new URL('./OperatorBookingHost.tsx', import.meta.url), 'utf8');
  const clean = code(source);

  it('reads billing state from useBilling, not a hand-rolled fetch or hardcoded flag', () => {
    expect(clean).toMatch(/useBilling\(\)/);
  });

  it('decides through bookingHostGate exactly once, not a hand-rolled frozen check', () => {
    const matches = clean.match(/bookingHostGate\(\{/g) ?? [];
    expect(matches.length).toBe(1);
    // Mutation target: computing "frozen" inline (e.g. `access?.frozen &&`)
    // instead of feeding it through the model.
    expect(clean).not.toMatch(/access\?\.frozen\s*&&\s*(?!.*bookingHostGate)/);
  });

  // THE mutation target for "the booking host opening the sheet while
  // frozen": OperatorBookingSheet's `open` prop must come from the model's
  // showSheet, never from the raw `open`/`!!paramId` the pre-task-12 version
  // used.
  it('renders the sheet from gate.showSheet, never from the raw param', () => {
    expect(clean).toMatch(/<OperatorBookingSheet\s+open=\{gate\.showSheet\}/);
    expect(clean).not.toMatch(/<OperatorBookingSheet\s+open=\{open\}/);
    expect(clean).not.toMatch(/<OperatorBookingSheet\s+open=\{!!paramId\}/);
  });

  it('opens the wall through usePaywall(), inside an effect, gated on gate.openWall', () => {
    expect(clean).toMatch(/usePaywall\(\)/);
    expect(clean).toMatch(/useEffect\(\(\) => \{[\s\S]*?if \(gate\.openWall\) openPaywall\(\)/);
  });

  it('clears the param through setParam(null) when the gate says to, never unconditionally', () => {
    expect(clean).toMatch(/if \(!gate\.clearParam\) return;/);
    expect(clean).toMatch(/setParam\(null\)/);
  });
});
