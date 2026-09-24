// Task 13, ruling R18: the innocent third party never learns their cleaning company has a
// money problem. This file pins the exact copy and the "omit the phone line" behavior as pure
// functions so a future edit that reintroduces a forbidden word, or that prints an empty
// "To book, call them on ." line, fails a test rather than shipping.

import { describe, it, expect } from 'vitest';
import {
  BOOKING_UNAVAILABLE_MESSAGE,
  BookingUnavailableError,
  callToBookLine,
  isBookingBlockedResponse,
} from './bookingUnavailable';

// Every word that would tell a homeowner their cleaning company has a billing problem. A
// forbidden word inside a LONGER, unrelated word (e.g. "explains") must not false-positive,
// so each check below uses a word-boundary regex rather than a plain substring search.
const FORBIDDEN_WORDS = [
  'billing',
  'subscription',
  'trial',
  'payment',
  'suspend',
  'suspension',
  'frozen',
  'freeze',
  'invoice',
  'stripe',
  'unpaid',
  'past due',
  'past_due',
  'paywall',
  'delinquent',
  'overdue',
];

function assertNoForbiddenWords(text: string): void {
  for (const word of FORBIDDEN_WORDS) {
    const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    expect(text, `"${text}" must not contain the word "${word}"`).not.toMatch(pattern);
  }
}

describe('BOOKING_UNAVAILABLE_MESSAGE', () => {
  // Mutation target: appending or swapping in any word from the forbidden list, e.g.
  // "...view-only mode until you update your billing." This is a word-list assertion over
  // the actual rendered copy, not a spot check, so it survives future edits to the sentence.
  it('never mentions billing, subscriptions, trials, payment, or suspension', () => {
    assertNoForbiddenWords(BOOKING_UNAVAILABLE_MESSAGE);
  });

  it('reassures that existing bookings are unaffected', () => {
    expect(BOOKING_UNAVAILABLE_MESSAGE).toContain('Your scheduled cleanings are not affected');
  });

  it('never uses an em dash', () => {
    expect(BOOKING_UNAVAILABLE_MESSAGE).not.toContain('—');
  });
});

describe('callToBookLine', () => {
  // Mutation target: dropping the truthiness check, e.g. `phone ? line : ''` or
  // `` `To book, call them on ${phone ?? ''}.` `` which would print an empty label instead
  // of omitting the line.
  it('omits the line entirely for null, undefined, empty, and whitespace-only phone', () => {
    expect(callToBookLine(null)).toBeNull();
    expect(callToBookLine(undefined)).toBeNull();
    expect(callToBookLine('')).toBeNull();
    expect(callToBookLine('   ')).toBeNull();
  });

  it('renders the number when one is present, trimmed', () => {
    expect(callToBookLine('  (555) 019-2345  ')).toBe('To book, call them on (555) 019-2345.');
  });

  it('the rendered line never mentions billing, subscriptions, trials, payment, or suspension', () => {
    const line = callToBookLine('(555) 019-2345');
    expect(line).not.toBeNull();
    assertNoForbiddenWords(line!);
  });

  it('never uses an em dash', () => {
    expect(callToBookLine('555-1234')).not.toContain('—');
  });
});

describe('isBookingBlockedResponse', () => {
  it('is true for exactly guard.ts\'s 402 billing_frozen shape', () => {
    expect(isBookingBlockedResponse(402, { error: 'billing_frozen' })).toBe(true);
  });

  // Mutation target: widening the check to any 402, which would treat an unrelated 402 (or a
  // future one) as a booking block and swallow it into the wrong message.
  it('is false for a 402 with a different error code', () => {
    expect(isBookingBlockedResponse(402, { error: 'some_other_reason' })).toBe(false);
  });

  it('is false for non-402 statuses even with the billing_frozen body', () => {
    expect(isBookingBlockedResponse(403, { error: 'billing_frozen' })).toBe(false);
    expect(isBookingBlockedResponse(500, { error: 'billing_frozen' })).toBe(false);
  });
});

describe('BookingUnavailableError', () => {
  it('is distinguishable from a generic Error via instanceof', () => {
    const e = new BookingUnavailableError();
    expect(e instanceof BookingUnavailableError).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(new Error('booking_unavailable') instanceof BookingUnavailableError).toBe(false);
  });
});
