import { describe, it, expect } from 'vitest';
import type { AdminAppointment } from '@/hooks/useAdminData';
import {
  ownedChips,
  timePillOptions,
  conflictFor,
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
  });

  describe('outcomeLine', () => {
    it('returns proper text for settled auto-approve (no cleaner change)', () => {
      const outcome: RescheduleOutcome = {
        kind: 'auto_approve',
        settled: true,
        status: 'confirmed',
        cleanerConfirmationStatus: 'approved',
        recomputeDeadline: false,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: null,
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: null,
      });
      expect(line).toBeTruthy();
      // Should not contain em dashes
      expect(line).not.toContain('—');
    });

    it('returns proper text for reask with 24-hour tier', () => {
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
      expect(line).toContain('Maria');
      expect(line).toContain('24 hours');
      expect(line).not.toContain('—');
    });

    it('returns proper text for reask with 4-hour tier', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Alice',
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: 4,
      });
      expect(line).toContain('Alice');
      expect(line).toContain('4 hours');
      expect(line).not.toContain('—');
    });

    it('returns proper text for employee settled outcome', () => {
      const outcome: RescheduleOutcome = {
        kind: 'employee_settled',
        settled: true,
        status: 'confirmed',
        cleanerConfirmationStatus: 'approved',
        recomputeDeadline: false,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Bob',
        cleanerChanged: false,
        escalatedUnassigned: false,
        tier: null,
      });
      expect(line).toBeTruthy();
      expect(line).not.toContain('—');
    });

    it('returns proper text for unassigned outcome', () => {
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
      expect(line).toBeTruthy();
      expect(line).not.toContain('—');
    });

    it('returns proper text for cleaner changed', () => {
      const outcome: RescheduleOutcome = {
        kind: 'reask',
        settled: false,
        status: 'pending',
        cleanerConfirmationStatus: 'awaiting',
        recomputeDeadline: true,
      };
      const line = outcomeLine({
        outcome,
        cleanerName: 'Charlie',
        cleanerChanged: true,
        escalatedUnassigned: false,
        tier: 24,
      });
      expect(line).toBeTruthy();
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
  });
});
