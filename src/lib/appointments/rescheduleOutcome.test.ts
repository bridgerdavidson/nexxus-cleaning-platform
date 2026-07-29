import { describe, it, expect } from 'vitest';
import {
  normalizeTimeHHMM,
  matchesOwnedSuggestion,
  decideRescheduleOutcome,
  planRescheduleNotifications,
  reaskTierHours,
  type SuggestionInputs,
} from './rescheduleOutcome';

const CLEANER = 'cleaner-1';
const OTHER = 'cleaner-2';

const suggestions: SuggestionInputs = {
  times: [{ feedbackCleanerId: CLEANER, suggestedDate: '2026-03-06', suggestedTime: '09:00:00' }],
  windows: [
    { feedbackCleanerId: CLEANER, windowDate: '2026-03-07', startTime: '13:00:00', endTime: '16:00:00' },
  ],
};

function decide(overrides: Partial<Parameters<typeof decideRescheduleOutcome>[0]> = {}) {
  return decideRescheduleOutcome({
    scheduledDate: '2026-03-06',
    scheduledTime: '09:00',
    targetCleanerId: CLEANER,
    currentCleanerId: CLEANER,
    orgDefaultPayoutModel: 'percentage',
    suggestions,
    ...overrides,
  });
}

describe('normalizeTimeHHMM', () => {
  it('normalizes HH:MM:SS and pads hours', () => {
    expect(normalizeTimeHHMM('9:00:00')).toBe('09:00');
    expect(normalizeTimeHHMM('13:30')).toBe('13:30');
    expect(normalizeTimeHHMM('bogus')).toBeNull();
  });
});

describe('matchesOwnedSuggestion', () => {
  it('matches an exact suggested time across HH:MM vs HH:MM:SS formats', () => {
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-06', '09:00', suggestions)).toBe(true);
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-06', '09:00:00', suggestions)).toBe(true);
  });
  it('rejects a suggestion owned by a different cleaner', () => {
    expect(matchesOwnedSuggestion(OTHER, '2026-03-06', '09:00', suggestions)).toBe(false);
  });
  it('window match is closed-interval at both boundaries', () => {
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '13:00', suggestions)).toBe(true); // start
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '16:00', suggestions)).toBe(true); // end (legacy parity)
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '16:01', suggestions)).toBe(false);
    expect(matchesOwnedSuggestion(CLEANER, '2026-03-07', '12:59', suggestions)).toBe(false);
  });
});

describe('decideRescheduleOutcome', () => {
  it('auto-approves same cleaner + owned suggestion', () => {
    const o = decide();
    expect(o).toMatchObject({ kind: 'auto_approve', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved', recomputeDeadline: false });
  });
  it('re-asks when the time matches no owned suggestion', () => {
    const o = decide({ scheduledTime: '10:00' });
    expect(o).toMatchObject({ kind: 'reask', settled: false, status: 'pending', cleanerConfirmationStatus: 'awaiting', recomputeDeadline: true });
  });
  it('re-asks when the suggestion belongs to another cleaner (no cross-owner auto-approve)', () => {
    const o = decide({
      suggestions: { times: [{ feedbackCleanerId: OTHER, suggestedDate: '2026-03-06', suggestedTime: '09:00' }], windows: [] },
    });
    expect(o.kind).toBe('reask');
  });
  it('settles for employee-model orgs even without a match', () => {
    const o = decide({ scheduledTime: '10:00', orgDefaultPayoutModel: 'hourly_external' });
    expect(o).toMatchObject({ kind: 'employee_settled', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved' });
  });
  it('auto-approve wins over employee-settled (match checked first)', () => {
    const o = decide({ orgDefaultPayoutModel: 'hourly_external' });
    expect(o.kind).toBe('auto_approve');
  });
  it('unassigned leaves status/confirmation untouched and clears the deadline', () => {
    const o = decide({ targetCleanerId: null, currentCleanerId: null });
    expect(o).toMatchObject({ kind: 'unassigned', settled: true, status: null, cleanerConfirmationStatus: null, recomputeDeadline: false });
  });
});

describe('planRescheduleNotifications', () => {
  it('auto-approve notifies the cleaner with the success event + homeowner', () => {
    expect(planRescheduleNotifications(decide(), false)).toEqual({
      cleanerEvent: 'cleaner_counter_accepted', requiresConfirmation: false, notifyHomeowner: true,
    });
  });
  it('re-ask same cleaner sends appointment_rescheduled with requires_confirmation, no homeowner event', () => {
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00' }), false)).toEqual({
      cleanerEvent: 'appointment_rescheduled', requiresConfirmation: true, notifyHomeowner: false,
    });
  });
  it('cleaner change re-ask sends cleaner_assigned; settled change sends cleaner_force_assigned', () => {
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00' }), true).cleanerEvent).toBe('cleaner_assigned');
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00', orgDefaultPayoutModel: 'hourly_external' }), true).cleanerEvent).toBe('cleaner_force_assigned');
  });
  it('employee settled same cleaner sends appointment_rescheduled FYI + homeowner event', () => {
    expect(planRescheduleNotifications(decide({ scheduledTime: '10:00', orgDefaultPayoutModel: 'hourly_external' }), false)).toEqual({
      cleanerEvent: 'appointment_rescheduled', requiresConfirmation: false, notifyHomeowner: true,
    });
  });
  it('unassigned sends no cleaner event but notifies the homeowner', () => {
    expect(planRescheduleNotifications(decide({ targetCleanerId: null, currentCleanerId: null }), false)).toEqual({
      cleanerEvent: null, requiresConfirmation: false, notifyHomeowner: true,
    });
  });
});

describe('reaskTierHours', () => {
  it('is 4 within 48h of the job and 24 beyond it', () => {
    const now = new Date(2026, 2, 5, 8, 0, 0); // Mar 5 2026 08:00 local
    expect(reaskTierHours('2026-03-06', '09:00', now)).toBe(4);
    expect(reaskTierHours('2026-03-20', '09:00', now)).toBe(24);
    expect(reaskTierHours('bogus', '09:00', now)).toBeNull();
  });
});
