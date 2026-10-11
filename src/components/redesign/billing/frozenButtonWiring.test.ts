// Task 12: "keep the buttons clickable." Every gated "new work" button must
// stay visible and clickable while a frozen org's owner (or admin/manager)
// looks at it, muted only through aria-disabled plus styling. Using the
// native `disabled` attribute instead swallows the click entirely: the
// button goes dead, the handler that would open the wall (or, for a
// non-owner, simply no-op) never runs, and the user gets neither the wall
// nor an explanation. THE mutation this file exists to catch is exactly
// that swap: `aria-disabled={frozen}` replaced with `disabled={frozen}`.
//
// This repo has no component-rendering setup and @testing-library/react is
// not installed, so each gated button is checked by statically scanning its
// source file instead.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function read(relativeToThisFile: string): string {
  return code(readFileSync(new URL(relativeToThisFile, import.meta.url), 'utf8'));
}

/**
 * One gated button prop, checked in the file it renders in. `occurrences` is
 * how many button instances pass the flag through (this repo has a header
 * button and an empty-state button for three of these screens).
 */
const CASES: Array<{ label: string; file: string; flag: string; occurrences: number }> = [
  { label: 'New booking (top bar)', file: '../shell/OperatorTopBar.tsx', flag: 'newBookingFrozen', occurrences: 1 },
  { label: 'New service', file: '../services/OperatorServicesView.tsx', flag: 'newServiceFrozen', occurrences: 2 },
  { label: 'New customer', file: '../customers/OperatorCustomersView.tsx', flag: 'newCustomerFrozen', occurrences: 2 },
  { label: 'Invite cleaner (toolbar create)', file: '../cleaners/PeopleToolbar.tsx', flag: 'createDisabled', occurrences: 1 },
  { label: 'Invite cleaner (empty state)', file: '../cleaners/OperatorCleanersView.tsx', flag: 'newCleanerFrozen', occurrences: 1 },
  { label: 'Invite team member (empty state)', file: '../cleaners/OperatorStaffView.tsx', flag: 'newStaffFrozen', occurrences: 1 },
];

describe('gated "new work" buttons use aria-disabled, never the disabled attribute', () => {
  for (const { label, file, flag, occurrences } of CASES) {
    it(`${label}: aria-disabled={${flag}...}, never disabled={${flag}}`, () => {
      const clean = read(file);

      // THE mutation target: `disabled={<flag>}` (or `disabled={<flag> ||
      // undefined}` etc.) on the gated button. The literal HTML disabled
      // attribute makes the control unclickable, so the click can never
      // reach the handler that opens the wall or (for a non-owner) no-ops.
      // (?<!aria-) excludes the legitimate aria-disabled={<flag>...} match
      // below, whose text also ends in "disabled={<flag>".
      expect(clean).not.toMatch(new RegExp(`(?<!aria-)disabled=\\{${flag}\\b`));

      const ariaMatches = clean.match(new RegExp(`aria-disabled=\\{${flag}\\b`, 'g')) ?? [];
      expect(ariaMatches.length, `expected ${occurrences} aria-disabled={${flag}...} occurrence(s)`).toBe(
        occurrences,
      );
    });
  }
});
