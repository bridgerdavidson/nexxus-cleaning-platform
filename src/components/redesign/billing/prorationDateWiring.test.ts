// Stripe prorates to the SECOND, and its prorations guide says to pass the same
// `proration_date` on the update that the preview was given. The server half of
// that is covered by real tests (planSelection.parseProrationDate, the
// updateSubscriptionItems payload, and the apply route's integration spec).
//
// This file covers the half no other test can see: the two components that hold
// a settled quote have to actually SEND the instant it was priced at. Drop the
// field in either one and every other test in the suite still passes, because
// the apply route treats a missing proration_date as "prorate at now", which is
// exactly the silent drift this whole change exists to remove.
//
// This repo has no component-rendering setup and @testing-library/react is not
// installed, so each call site is checked by statically scanning its source, the
// same approach as frozenButtonWiring.test.ts.

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

/** Strips comments, so a guard can never be satisfied by prose about the rule. */
function code(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function read(relativeToThisFile: string): string {
  return code(readFileSync(new URL(relativeToThisFile, import.meta.url), 'utf8'))
}

const CASES: Array<{ label: string; file: string; source: string }> = [
  // Submits through the host's onSubmit, which forwards the body to changePlan.
  { label: 'PlanPicker', file: './PlanPicker.tsx', source: 'preview.proration_date' },
  // Submits changePlan directly, from the seat quote.
  { label: 'SeatCapDialog', file: './SeatCapDialog.tsx', source: 'quote.preview.proration_date' },
]

describe('the purchase submit sends the instant its quote was priced at', () => {
  for (const { label, file, source } of CASES) {
    it(`${label} passes proration_date straight off the settled preview`, () => {
      const clean = read(file)
      expect(clean).toContain(`proration_date: ${source}`)
    })

    // A literal, a Date.now() recomputation, or anything not read off the
    // preview defeats the point: the whole value of the field is that it is the
    // SAME second Stripe already priced against.
    it(`${label} never invents its own proration instant`, () => {
      const clean = read(file)
      expect(clean).not.toMatch(/proration_date:\s*(Math\.floor|Date\.now|\d)/)
    })
  }
})

// The type that carries it. Optional on purpose (the preview route ignores it,
// and a first purchase has none), which is why the guards above are needed: a
// dropped field is not a compile error.
describe('PlanSelectionBody carries the field', () => {
  it('declares proration_date as an optional number', () => {
    const clean = read('./billing-api.ts')
    expect(clean).toMatch(/proration_date\?:\s*number\s*\|\s*null/)
  })
})
