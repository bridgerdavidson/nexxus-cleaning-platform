import { describe, it, expect } from 'vitest';
import { photoStatusLabel, checklistProgressLabel, formatCents, completeSuccessCopy } from './active-job-presenters';

describe('photoStatusLabel', () => {
  it('no photos', () => expect(photoStatusLabel(0, 0)).toBe('No photos yet'));
  it('one confirmed', () => expect(photoStatusLabel(1, 0)).toBe('1 photo added'));
  it('multiple confirmed', () => expect(photoStatusLabel(3, 0)).toBe('3 photos added'));
  it('uploading', () => expect(photoStatusLabel(1, 2)).toBe('1 photo added, 2 uploading'));
});

describe('checklistProgressLabel', () => {
  it('counts', () => expect(checklistProgressLabel(2, 5)).toBe('2 of 5 done'));
  it('all done', () => expect(checklistProgressLabel(5, 5)).toBe('All 5 done'));
  it('empty list', () => expect(checklistProgressLabel(0, 0)).toBe('No tasks'));
});

describe('formatCents', () => {
  it('dollars', () => expect(formatCents(12000)).toBe('$120.00'));
  it('zero', () => expect(formatCents(0)).toBe('$0.00'));
  it('cents only', () => expect(formatCents(99)).toBe('$0.99'));
  it('exact dollar', () => expect(formatCents(4800)).toBe('$48.00'));
});

describe('completeSuccessCopy', () => {
  it('charged includes cut dollars and no em dash', () => {
    const c = completeSuccessCopy('charged', 4800);
    expect(c.title).toBe('Job complete');
    expect(c.body).toContain('$48.00');
    expect(c.body).not.toContain('—');
  });

  it('request auto-approved states the earned amount', () => {
    const c = completeSuccessCopy('charged', 0, {
      payRequest: { submitted: true, autoApproved: true, amountCents: 12000 },
    });
    expect(c.title).toBe('Job complete');
    expect(c.body).toContain('$120.00');
    expect(c.body.toLowerCase()).toContain('earned');
    expect(c.body).not.toContain('—');
  });

  it('request escalated says it is awaiting review, with no amount promised', () => {
    const c = completeSuccessCopy('charged', 0, {
      payRequest: { submitted: true, autoApproved: false, amountCents: 30000 },
    });
    expect(c.title).toBe('Job complete');
    expect(c.body.toLowerCase()).toContain('approval');
    expect(c.body.toLowerCase()).toContain('notification');
    // An escalated ask is not yet money, so it must not read as earned.
    expect(c.body.toLowerCase()).not.toContain('earned');
    expect(c.body).not.toContain('—');
  });

  it('request copy wins over the charge outcome (their pay does not depend on it)', () => {
    // The customer's card failing is the operator's problem; the cleaner's
    // request still stands, so they must not see the payment-issue copy.
    const c = completeSuccessCopy('failed', 0, {
      payRequest: { submitted: true, autoApproved: true, amountCents: 9000 },
    });
    expect(c.body).toContain('$90.00');
    expect(c.body.toLowerCase()).not.toContain('payment issue');
  });
  it('processing (ACH) body mentions processing', () => {
    expect(completeSuccessCopy('processing', 4800).body.toLowerCase()).toContain('processing');
  });
  it('declined surfaces calmly, no blame, mentions operator', () => {
    const c = completeSuccessCopy('declined', 4800);
    expect(c.title).toBe('Job complete');
    expect(c.body.toLowerCase()).toContain('operator');
  });
  it('failed is calm, no blame, mentions operator', () => {
    const c = completeSuccessCopy('failed', 4800);
    expect(c.title).toBe('Job complete');
    expect(c.body.toLowerCase()).toContain('operator');
  });
  it('no_card is calm, mentions operator', () => {
    const c = completeSuccessCopy('no_card', 4800);
    expect(c.title).toBe('Job complete');
    expect(c.body.toLowerCase()).toContain('operator');
  });
  it('requires_action is calm, mentions operator', () => {
    const c = completeSuccessCopy('requires_action', 4800);
    expect(c.title).toBe('Job complete');
    expect(c.body.toLowerCase()).toContain('operator');
  });
  it('unknown outcome still returns title Job complete', () => {
    expect(completeSuccessCopy(undefined, 4800).title).toBe('Job complete');
  });
  it('no copy contains em dash', () => {
    for (const outcome of ['charged', 'processing', 'declined', 'failed', 'no_card', 'requires_action', undefined] as const) {
      expect(completeSuccessCopy(outcome, 4800).body).not.toContain('—');
    }
  });
});
