// Task 13, ruling R18: the pure copy in bookingUnavailable.test.ts is only worth something if
// the four write paths that can hit it are actually wired correctly. This repo has no
// component-rendering setup and @testing-library/react is not installed, so each is checked by
// statically scanning its source file instead, the same pattern as
// billing/frozenButtonWiring.test.ts and billing/billingActionParity.test.ts.
//
// The three things a mutation could silently break here:
//   1. A 402 falling through to the generic toast/error-box path instead of the persistent
//      notice (a toast disappears; this must not).
//   2. The blocked branch swallowing a DIFFERENT failure along with it (a real network error,
//      a validation 400, etc. must still reach the homeowner).
//   3. Either write path being routed back through apiFetch, whose 402 net opens the
//      owner-only paywall (usePaywall.openPaywall) and hands back a promise that never
//      resolves. Both are wrong for a homeowner.

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

describe('useSubmitBookingRequest: the request-a-cleaning write path', () => {
  const source = read('./booking/useSubmitBookingRequest.ts');

  it('never routes through apiFetch (its 402 net is owner-only)', () => {
    expect(source).not.toMatch(/from ['"]@\/lib\/auth\/apiFetch['"]/);
    expect(source).not.toMatch(/\bapiFetch\(/);
  });

  // Mutation target: deleting the blocked check, or moving it AFTER the generic
  // `!res.ok` throw, which would turn every blocked write into a generic
  // "Could not send your request" toast instead of the persistent notice.
  it('throws BookingUnavailableError for a blocked response, checked before the generic error', () => {
    expect(source).toMatch(/isBookingBlockedResponse\(res\.status, data\)/);
    const blockedIdx = source.indexOf('throw new BookingUnavailableError()');
    const genericIdx = source.indexOf('throw new Error(data.error');
    expect(blockedIdx, 'BookingUnavailableError throw not found').toBeGreaterThan(-1);
    expect(genericIdx, 'generic Error throw not found').toBeGreaterThan(-1);
    expect(blockedIdx).toBeLessThan(genericIdx);
  });
});

describe('BookingFlow.tsx: handleSend wires the blocked branch, never opens the owner paywall', () => {
  const source = read('./booking/BookingFlow.tsx');

  it('never imports or calls the owner-only paywall', () => {
    expect(source).not.toMatch(/openPaywall/);
    expect(source).not.toMatch(/usePaywall/);
  });

  const body = source.match(/async function handleSend\(\) \{([\s\S]*?)\n {2}\}/);
  it('handleSend was found in the file', () => {
    expect(body, 'handleSend not found in BookingFlow.tsx').not.toBeNull();
  });

  const blockedBranch = body?.[1].match(
    /if \(e instanceof BookingUnavailableError\) \{([\s\S]*?)\n {6}\}/,
  );

  // Mutation target: the branch below being deleted, or the toast call moved inside it, which
  // would turn a blocked write into a transient toast, exactly what R18 forbids.
  it('the blocked branch shows the persistent notice and never calls toast.error', () => {
    expect(blockedBranch, 'the instanceof BookingUnavailableError branch was not found').not.toBeNull();
    const branchBody = blockedBranch![1];
    expect(branchBody).toMatch(/setBlocked\(true\)/);
    expect(branchBody).not.toMatch(/toast\.error/);
    // The branch must exit (return) rather than fall through into the toast call below it,
    // which would show BOTH the notice and a toast for the same failure.
    expect(branchBody).toMatch(/return;/);
  });

  // Mutation target: deleting the fallback toast entirely while "fixing" the blocked branch,
  // which would silently swallow every OTHER failure (network error, validation error, ...).
  it('a non-blocked failure still reaches the homeowner via the original toast', () => {
    const withoutBlockedBranch = body![1].replace(
      /if \(e instanceof BookingUnavailableError\) \{[\s\S]*?\n {6}\}/,
      '',
    );
    expect(withoutBlockedBranch).toMatch(/toast\.error\(\s*['"]Could not send your request['"]/);
  });
});

describe('properties-api.ts: the add-a-home write path', () => {
  const source = read('./account/properties/properties-api.ts');

  it('never routes through apiFetch (its 402 net is owner-only)', () => {
    expect(source).not.toMatch(/from ['"]@\/lib\/auth\/apiFetch['"]/);
    expect(source).not.toMatch(/\bapiFetch\(/);
  });

  it('throws BookingUnavailableError for a blocked response, checked before the generic error', () => {
    expect(source).toMatch(/isBookingBlockedResponse\(res\.status, data\)/);
    const blockedIdx = source.indexOf('throw new BookingUnavailableError()');
    const genericIdx = source.indexOf('throw new Error(data.error');
    expect(blockedIdx, 'BookingUnavailableError throw not found').toBeGreaterThan(-1);
    expect(genericIdx, 'generic Error throw not found').toBeGreaterThan(-1);
    expect(blockedIdx).toBeLessThan(genericIdx);
  });
});

describe('PropertyFormSheet.tsx: onSave wires the blocked branch, never opens the owner paywall', () => {
  const source = read('./account/properties/PropertyFormSheet.tsx');

  it('never imports or calls the owner-only paywall', () => {
    expect(source).not.toMatch(/openPaywall/);
    expect(source).not.toMatch(/usePaywall/);
  });

  const body = source.match(/async function onSave\(\) \{([\s\S]*?)\n {2}\}/);
  it('onSave was found in the file', () => {
    expect(body, 'onSave not found in PropertyFormSheet.tsx').not.toBeNull();
  });

  const blockedBranch = body?.[1].match(
    /if \(e instanceof BookingUnavailableError\) \{([\s\S]*?)\n {6}\}/,
  );

  // Mutation target: the branch below being deleted, or setError moved inside it, which would
  // render the generic critical-red error box (or nothing, if setSaving hangs) instead of the
  // persistent homeowner notice.
  it('the blocked branch shows the persistent notice and never calls setError', () => {
    expect(blockedBranch, 'the instanceof BookingUnavailableError branch was not found').not.toBeNull();
    const branchBody = blockedBranch![1];
    expect(branchBody).toMatch(/setBlocked\(true\)/);
    expect(branchBody).not.toMatch(/setError\(/);
    expect(branchBody).toMatch(/return;/);
  });

  // Mutation target: deleting the fallback setError entirely while "fixing" the blocked
  // branch, which would silently swallow every OTHER failure (validation, network, a real
  // save error) with no feedback at all.
  it('a non-blocked failure still reaches the homeowner via the original error box', () => {
    const withoutBlockedBranch = body![1].replace(
      /if \(e instanceof BookingUnavailableError\) \{[\s\S]*?\n {6}\}/,
      '',
    );
    expect(withoutBlockedBranch).toMatch(
      /setError\(e instanceof Error \? e\.message : 'Could not save the property\.'\)/,
    );
  });
});
