import { describe, it, expect } from 'vitest';
import type { AdminAppointment } from '@/hooks/useAdminData';
import {
  ownedChips,
  timePillOptions,
  conflictFor,
  outcomeFor,
  outcomeLine,
  primaryLabel,
  seriesLine,
} from './deriveReschedule';
import type { RescheduleSelection } from './deriveReschedule';
import type { RescheduleOutcome } from '@/lib/appointments/rescheduleOutcome';

// Helper to build a minimal AdminAppointment fixture
function mkAppt(overrides: Partial<AdminAppointment> = {}): AdminAppointment {
  const base: AdminAppointment = {
    id: 'apt-1',
    organization_id: 'org-1',
    cleaner_id: 'cleaner-1',
    homeowner_id: 'homeowner-1',
    scheduled_date: '2026-03-06',
    scheduled_time: '10:00',
    duration_minutes: 120,
    status: 'confirmed',
    series_id: null,
    cleaner_availability_feedback: [],
    property: null,
    homeowner: null,
    cleaner_profile: null,
    service_type: null,
    is_self_pay: false,
    payment_status: null,
    price_override_enabled: false,
    price_override_total: null,
    total_price: 120,
    special_requests: null,
    notes: null,
  };
  return { ...base, ...overrides };
}

describe('deriveReschedule', () => {
  describe('ownedChips', () => {
    it('includes only the current cleaner\'s suggested times', () => {
      const appt = mkAppt({
        cleaner_id: 'cleaner-1',
        cleaner_availability_feedback: [
          {
            id: 'fb-1',
            cleaner_id: 'cleaner-1',
            reason: null,
            cleaner_suggested_times: [
              { id: 'time-1', suggested_date: '2026-03-07', suggested_time: '14:00' },
            ],
            cleaner_suggested_windows: [],
          },
          {
            id: 'fb-2',
            cleaner_id: 'cleaner-2', // different cleaner
            reason: null,
            cleaner_suggested_times: [
              { id: 'time-2', suggested_date: '2026-03-08', suggested_time: '15:00' },
            ],
            cleaner_suggested_windows: [],
          },
        ],
      });
      const chips = ownedChips(appt);
      expect(chips).toHaveLength(1);
      expect(chips[0].kind).toBe('time');
      expect(chips[0].date).toBe('2026-03-07');
      expect(chips[0].time).toBe('14:00');
    });

    it('includes only the current cleaner\'s suggested windows', () => {
      const appt = mkAppt({
        cleaner_id: 'cleaner-1',
        cleaner_availability_feedback: [
          {
            id: 'fb-1',
            cleaner_id: 'cleaner-1',
            reason: null,
            cleaner_suggested_times: [],
            cleaner_suggested_windows: [
              { id: 'win-1', window_date: '2026-03-07', start_time: '13:00', end_time: '16:00' },
            ],
          },
        ],
      });
      const chips = ownedChips(appt);
      expect(chips).toHaveLength(1);
      expect(chips[0].kind).toBe('window');
      expect(chips[0].date).toBe('2026-03-07');
      expect(chips[0].startTime).toBe('13:00');
      expect(chips[0].endTime).toBe('16:00');
    });
  });

  describe('timePillOptions', () => {
    it('starts with the constraint start time when constrained', () => {
      const options = timePillOptions({ startTime: '13:15', endTime: '15:40' });
      expect(options[0].value).toBe('13:15');
      expect(options[0].label).toContain('1:15pm');
    });

    it('includes 14:00 and 15:00 for the example constraint', () => {
      const options = timePillOptions({ startTime: '13:15', endTime: '15:40' });
      const values = options.map((o) => o.value);
      expect(values).toContain('14:00');
      expect(values).toContain('15:00');
    });

    it('closes interval: includes end boundary time when it matches exactly', () => {
      const options = timePillOptions({ startTime: '13:00', endTime: '15:00' });
      const values = options.map((o) => o.value);
      expect(values).toContain('15:00');
    });

    it('returns base options when constraint is null', () => {
      const options = timePillOptions(null);
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].value).toBe('08:00');
    });

    it('yields only the injected start pill when the window has no grid pill inside it', () => {
      // 13:15-13:45 straddles no hourly grid point (13:00 < start, 14:00 > end).
      const options = timePillOptions({ startTime: '13:15', endTime: '13:45' });
      expect(options).toHaveLength(1);
      expect(options[0].value).toBe('13:15');
    });
  });

  describe('outcomeFor', () => {
    it('auto-approves when the selection matches the current cleaner\'s own suggestion', () => {
      const appt = mkAppt({
        cleaner_id: 'cleaner-1',
        cleaner_availability_feedback: [
          {
            id: 'fb-1',
            cleaner_id: 'cleaner-1',
            reason: null,
            cleaner_suggested_times: [
              { id: 'time-1', suggested_date: '2026-03-07', suggested_time: '14:00' },
            ],
            cleaner_suggested_windows: [],
          },
        ],
      });
      const sel: RescheduleSelection = { date: '2026-03-07', time: '14:00', cleanerId: 'cleaner-1' };
      const outcome = outcomeFor(appt, sel, 'percentage_contractor');
      expect(outcome.kind).toBe('auto_approve');
    });

    it('returns unassigned when the selection has no cleaner', () => {
      const appt = mkAppt({ cleaner_id: 'cleaner-1' });
      const sel: RescheduleSelection = { date: '2026-03-07', time: '14:00', cleanerId: null };
      const outcome = outcomeFor(appt, sel, 'percentage_contractor');
      expect(outcome.kind).toBe('unassigned');
    });

    it('returns reask for a contractor-model org when no suggestion matches', () => {
      const appt = mkAppt({ cleaner_id: 'cleaner-1', cleaner_availability_feedback: [] });
      const sel: RescheduleSelection = { date: '2026-03-07', time: '14:00', cleanerId: 'cleaner-1' };
      const outcome = outcomeFor(appt, sel, 'percentage_contractor');
      expect(outcome.kind).toBe('reask');
    });

    it('returns employee_settled for non-contractor payout models regardless of a match', () => {
      const appt = mkAppt({ cleaner_id: 'cleaner-1', cleaner_availability_feedback: [] });
      const sel: RescheduleSelection = { date: '2026-03-07', time: '14:00', cleanerId: 'cleaner-1' };
      const outcome = outcomeFor(appt, sel, 'hourly_external');
      expect(outcome.kind).toBe('employee_settled');
    });
  });

  describe('outcomeLine', () => {
    // Exact literal spec strings from docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md (lines 53-58).
    it('auto-approve: matches the target cleaner\'s own suggestion', () => {
      const outcome: RescheduleOutcome = {
        kind: 'auto_approve',
        settled: true,
        status: 'confirmed',
        cleanerConfirmationStatus: 'approved',
        recomputeDeadline: false,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Maria',
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: null,
      });
      expect(line).toBe("Matches Maria's suggestion. Confirms instantly, no re-confirmation needed.");
    });

    it('reask, same cleaner, 24-hour tier', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Maria',
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: 24,
      });
      expect(line).toBe('Maria will be asked to re-confirm this time. They will have 24 hours to respond.');
    });

    it('reask, same cleaner, 4-hour tier (slot under 48h away)', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Maria',
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: 4,
      });
      expect(line).toBe('Maria will be asked to re-confirm this time. They will have 4 hours to respond.');
    });

    it('reask, cleaner changed: the new cleaner is asked to confirm, not re-confirm', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'James',
        cleanerChanged: true,
        escalatedUnassigned: false,
        tier: 24,
      });
      expect(line).toBe('James will be asked to confirm this time. They will have 24 hours to respond.');
      expect(line).not.toContain('re-confirm');
    });

    it('employee org settled', () => {
      const outcome: RescheduleOutcome = {
        kind: 'employee_settled',
        settled: true,
        status: 'confirmed',
        cleanerConfirmationStatus: 'approved',
        recomputeDeadline: false,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Maria',
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: null,
      });
      expect(line).toBe('Maria will be notified of the new time.');
    });

    it('unassigned, fresh (booking had no cleaner)', () => {
      const outcome: RescheduleOutcome = {
        kind: 'unassigned',
        settled: true,
        status: null,
        cleanerConfirmationStatus: null,
        recomputeDeadline: false,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: null,
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: null,
      });
      expect(line).toBe('No cleaner is assigned yet. The new time takes effect right away.');
    });

    it('unassigned, escalated (operator cleared the cleaner)', () => {
      const outcome: RescheduleOutcome = {
        kind: 'unassigned',
        settled: true,
        status: null,
        cleanerConfirmationStatus: null,
        recomputeDeadline: false,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: null,
        cleanerChanged: false,
        escalatedUnassigned: true,
        tier: null,
      });
      expect(line).toBe('The new time is saved. This booking still needs a cleaner.');
    });

    it('never contains an em dash', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Maria',
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: 24,
      });
      expect(line).not.toContain('—');
    });
  });

  describe('primaryLabel', () => {
    it('returns "Reschedule anyway" when there is a conflict', () => {
      const outcome: RescheduleOutcome = {
        kind: 'auto_approve',
        settled: true,
        status: 'confirmed',
        cleanerConfirmationStatus: 'approved',
        recomputeDeadline: false,
      };
      const label = primaryLabel(outcome, true, 'Maria');
      expect(label).toBe('Reschedule anyway');
    });

    it('returns "Send to <name>" when outcome is not settled and cleaner is set', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const label = primaryLabel(outcome, false, 'Maria');
      expect(label).toBe('Send to Maria');
    });

    it('returns "Send to cleaner" when outcome is not settled and no name', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const label = primaryLabel(outcome, false, null);
      expect(label).toBe('Send to cleaner');
    });

    it('returns "Confirm reschedule" when outcome is settled and no conflict', () => {
      const outcome: RescheduleOutcome = {
        kind: 'auto_approve',
        settled: true,
        status: 'confirmed',
        cleanerConfirmationStatus: 'approved',
        recomputeDeadline: false,
      };
      const label = primaryLabel(outcome, false, 'Maria');
      expect(label).toBe('Confirm reschedule');
    });
  });

  describe('seriesLine', () => {
    it('returns null when there is no series_id', () => {
      const appt = mkAppt({ series_id: null });
      const line = seriesLine(appt);
      expect(line).toBeNull();
    });

    it('returns series warning when series_id is set', () => {
      const appt = mkAppt({ series_id: 'series-1' });
      const line = seriesLine(appt);
      expect(line).toContain('repeating series');
      expect(line).toContain('this cleaning only');
      expect(line).not.toContain('—');
    });
  });

  describe('conflictFor', () => {
    it('returns null when no conflicts', () => {
      const appointments: AdminAppointment[] = [
        mkAppt({
          id: 'apt-2',
          cleaner_id: 'cleaner-1',
          scheduled_date: '2026-03-06',
          scheduled_time: '13:00',
          duration_minutes: 60,
        }),
      ];
      const sel: RescheduleSelection = { date: '2026-03-07', time: '14:00', cleanerId: 'cleaner-1' };
      const result = conflictFor(appointments, sel, 'apt-1');
      expect(result).toBeNull();
    });

    it('finds an overlapping appointment', () => {
      const appointments: AdminAppointment[] = [
        mkAppt({
          id: 'apt-2',
          cleaner_id: 'cleaner-1',
          scheduled_date: '2026-03-06',
          scheduled_time: '10:00',
          duration_minutes: 120,
          homeowner: { first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
          property: { address: '123 Main St', name: 'Main St', city: 'Boston', state: 'MA' },
        }),
      ];
      const sel: RescheduleSelection = { date: '2026-03-06', time: '11:00', cleanerId: 'cleaner-1' };
      const result = conflictFor(appointments, sel, 'apt-1');
      expect(result).not.toBeNull();
      expect(result?.label).toContain('John Doe');
      expect(result?.label).toContain('11:00am');
    });

    it('excludes the target appointment itself', () => {
      const appointments: AdminAppointment[] = [
        mkAppt({
          id: 'apt-1', // same as excludeId
          cleaner_id: 'cleaner-1',
          scheduled_date: '2026-03-06',
          scheduled_time: '10:00',
          duration_minutes: 120,
        }),
      ];
      const sel: RescheduleSelection = { date: '2026-03-06', time: '10:30', cleanerId: 'cleaner-1' };
      const result = conflictFor(appointments, sel, 'apt-1');
      expect(result).toBeNull();
    });

    it('returns null when cleanerId is not set', () => {
      const appointments: AdminAppointment[] = [
        mkAppt({
          id: 'apt-2',
          cleaner_id: 'cleaner-1',
          scheduled_date: '2026-03-06',
          scheduled_time: '10:00',
        }),
      ];
      const sel: RescheduleSelection = { date: '2026-03-06', time: '11:00', cleanerId: null };
      const result = conflictFor(appointments, sel, 'apt-1');
      expect(result).toBeNull();
    });

    it('derives the candidate duration from the appointment being rescheduled: a 120-minute candidate does not reach the next booking', () => {
      const appointments: AdminAppointment[] = [
        // The appointment being rescheduled; its duration_minutes drives the candidate size.
        mkAppt({ id: 'apt-1', cleaner_id: 'cleaner-1', scheduled_date: '2026-03-06', scheduled_time: '09:00', duration_minutes: 120 }),
        // Occupies 13:00-14:00.
        mkAppt({ id: 'apt-2', cleaner_id: 'cleaner-1', scheduled_date: '2026-03-06', scheduled_time: '13:00', duration_minutes: 60 }),
      ];
      const sel: RescheduleSelection = { date: '2026-03-06', time: '11:00', cleanerId: 'cleaner-1' };
      // 11:00 + 120min = ends exactly at 13:00; back-to-back is not a conflict.
      const result = conflictFor(appointments, sel, 'apt-1');
      expect(result).toBeNull();
    });

    it('derives the candidate duration from the appointment being rescheduled: a 240-minute candidate detects a conflict the 120-minute one misses', () => {
      const appointments: AdminAppointment[] = [
        // Same target appointment, but now with a 240-minute duration.
        mkAppt({ id: 'apt-1', cleaner_id: 'cleaner-1', scheduled_date: '2026-03-06', scheduled_time: '09:00', duration_minutes: 240 }),
        // Occupies 13:00-14:00.
        mkAppt({
          id: 'apt-2',
          cleaner_id: 'cleaner-1',
          scheduled_date: '2026-03-06',
          scheduled_time: '13:00',
          duration_minutes: 60,
          homeowner: { first_name: 'Jane', last_name: 'Roe', email: 'jane@example.com' },
        }),
      ];
      const sel: RescheduleSelection = { date: '2026-03-06', time: '11:00', cleanerId: 'cleaner-1' };
      // 11:00 + 240min = 15:00, which overlaps 13:00-14:00.
      const result = conflictFor(appointments, sel, 'apt-1');
      expect(result).not.toBeNull();
      expect(result?.label).toContain('Jane Roe');
    });
  });
});
