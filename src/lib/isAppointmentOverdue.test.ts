import { describe, it, expect } from 'vitest';
import {
  isAppointmentOverdue,
  deadlineUrgency,
  type OverdueAppointment,
} from './isAppointmentOverdue';

const NOW = new Date(2026, 4, 19, 12, 0, 0, 0); // 2026-05-19 12:00 local

describe('isAppointmentOverdue', () => {
  it('returns true when awaiting + deadline already passed', () => {
    const apt: OverdueAppointment = {
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h ago
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(true);
  });

  it('returns false when awaiting but deadline is in the future', () => {
    const apt: OverdueAppointment = {
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: new Date(NOW.getTime() + 60 * 60 * 1000), // 1h from now
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(false);
  });

  it('returns false when cleaner already approved (SLA stops on response)', () => {
    const apt: OverdueAppointment = {
      status: 'confirmed',
      cleaner_confirmation_status: 'approved',
      response_deadline: new Date(NOW.getTime() - 60 * 60 * 1000),
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(false);
  });

  it('returns false when cleaner rejected (counter-proposed / declined)', () => {
    const apt: OverdueAppointment = {
      status: 'pending',
      cleaner_confirmation_status: 'rejected',
      response_deadline: new Date(NOW.getTime() - 60 * 60 * 1000),
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(false);
  });

  it('returns false when cancelled', () => {
    const apt: OverdueAppointment = {
      status: 'cancelled',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: new Date(NOW.getTime() - 60 * 60 * 1000),
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(false);
  });

  it('returns false when response_deadline is null', () => {
    const apt: OverdueAppointment = {
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: null,
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(false);
  });

  it('accepts ISO string deadlines', () => {
    const apt: OverdueAppointment = {
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: new Date(NOW.getTime() - 1000).toISOString(),
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(true);
  });

  it('returns false when deadline string is unparseable', () => {
    const apt: OverdueAppointment = {
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: 'not-a-date',
    };
    expect(isAppointmentOverdue(apt, NOW)).toBe(false);
  });
});

describe('deadlineUrgency', () => {
  const issuedAt = new Date(NOW.getTime() - 1 * 60 * 60 * 1000); // 1h ago
  const deadlinePlenty = new Date(NOW.getTime() + 10 * 60 * 60 * 1000); // 10h ahead
  const deadlineSoon = new Date(NOW.getTime() + 1.5 * 60 * 60 * 1000); // 1.5h ahead

  it('returns null when cleaner has already responded', () => {
    expect(
      deadlineUrgency(
        {
          cleaner_confirmation_status: 'approved',
          response_deadline: deadlinePlenty,
        },
        issuedAt,
        NOW,
      ),
    ).toBeNull();
  });

  it('returns "overdue" when deadline passed', () => {
    expect(
      deadlineUrgency(
        {
          cleaner_confirmation_status: 'awaiting',
          response_deadline: new Date(NOW.getTime() - 1000),
        },
        issuedAt,
        NOW,
      ),
    ).toBe('overdue');
  });

  it('returns "plenty" when most of the window is remaining', () => {
    // issued 1h ago, deadline 23h ahead → 24h total, 23h remaining = 95% > 50%
    expect(
      deadlineUrgency(
        {
          cleaner_confirmation_status: 'awaiting',
          response_deadline: new Date(NOW.getTime() + 23 * 60 * 60 * 1000),
        },
        new Date(NOW.getTime() - 1 * 60 * 60 * 1000),
        NOW,
      ),
    ).toBe('plenty');
  });

  it('returns "soon" when 10–50% of window remains', () => {
    // issued 3h ago, deadline 1h ahead → 4h total, 1h remaining = 25%
    expect(
      deadlineUrgency(
        {
          cleaner_confirmation_status: 'awaiting',
          response_deadline: deadlineSoon,
        },
        new Date(NOW.getTime() - 2.5 * 60 * 60 * 1000),
        NOW,
      ),
    ).toBe('soon');
  });

  it('returns "urgent" when <10% of window remains', () => {
    // issued 23h ago, deadline 1h ahead → 24h total, 1h remaining = ~4%
    expect(
      deadlineUrgency(
        {
          cleaner_confirmation_status: 'awaiting',
          response_deadline: new Date(NOW.getTime() + 60 * 60 * 1000),
        },
        new Date(NOW.getTime() - 23 * 60 * 60 * 1000),
        NOW,
      ),
    ).toBe('urgent');
  });

  it('falls back to absolute heuristic when issuedAt is null', () => {
    // deadline 30min away, no issuedAt → urgent
    expect(
      deadlineUrgency(
        {
          cleaner_confirmation_status: 'awaiting',
          response_deadline: new Date(NOW.getTime() + 30 * 60 * 1000),
        },
        null,
        NOW,
      ),
    ).toBe('urgent');

    // deadline 5h away, no issuedAt → soon
    expect(
      deadlineUrgency(
        {
          cleaner_confirmation_status: 'awaiting',
          response_deadline: new Date(NOW.getTime() + 5 * 60 * 60 * 1000),
        },
        null,
        NOW,
      ),
    ).toBe('soon');
  });
});
