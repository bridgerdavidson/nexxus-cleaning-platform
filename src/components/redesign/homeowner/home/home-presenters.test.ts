import { describe, it, expect } from 'vitest';
import type { Appointment } from '@/hooks/useHomeownerData';
import {
  pickHeroAppointment,
  deriveHeroState,
  homeownerStatusLabel,
  cleanerDisplayName,
  formatCleaningWhen,
  recentCleaningTaskLabel,
  recentCleaningPaymentBadge,
} from './home-presenters';

const TODAY = '2026-06-25';

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    scheduled_date: '2026-06-26',
    scheduled_time: '10:30',
    status: 'confirmed',
    total_price: 120,
    property: { name: 'Home', address: '123 Maple Ave' } as Appointment['property'],
    service_type: { name: 'Deep clean', description: '' },
    checklist: null,
    cleaner_profile: { user_profile: { first_name: 'Marco', last_name: 'Diaz' } },
    payment_status: null,
    ...over,
  };
}

describe('pickHeroAppointment', () => {
  it('prefers an in-progress cleaning', () => {
    const inProg = appt({ id: 'p', status: 'in_progress', scheduled_date: '2026-06-25' });
    const result = pickHeroAppointment([appt({ id: 'u' }), inProg], TODAY);
    expect(result?.id).toBe('p');
  });

  it('otherwise returns the soonest upcoming active cleaning', () => {
    const later = appt({ id: 'later', scheduled_date: '2026-06-28' });
    const sooner = appt({ id: 'sooner', scheduled_date: '2026-06-26' });
    const past = appt({ id: 'past', scheduled_date: '2026-06-20', status: 'completed' });
    expect(pickHeroAppointment([later, past, sooner], TODAY)?.id).toBe('sooner');
  });

  it('falls back to the most recent completed cleaning', () => {
    const oldDone = appt({ id: 'old', scheduled_date: '2026-06-10', status: 'completed' });
    const newDone = appt({ id: 'new', scheduled_date: '2026-06-22', status: 'completed' });
    expect(pickHeroAppointment([oldDone, newDone], TODAY)?.id).toBe('new');
  });

  it('returns null when there is nothing to show', () => {
    expect(pickHeroAppointment([], TODAY)).toBeNull();
    expect(pickHeroAppointment([appt({ status: 'cancelled' })], TODAY)).toBeNull();
  });
});

describe('deriveHeroState', () => {
  it('maps appointment status to a hero state', () => {
    expect(deriveHeroState(null)).toBe('empty');
    expect(deriveHeroState(appt({ status: 'in_progress' }))).toBe('in_progress');
    expect(deriveHeroState(appt({ status: 'completed' }))).toBe('complete');
    expect(deriveHeroState(appt({ status: 'confirmed' }))).toBe('upcoming');
    expect(deriveHeroState(appt({ status: 'pending' }))).toBe('upcoming');
  });
});

describe('homeownerStatusLabel', () => {
  it('uses warm consumer copy + a tone per status', () => {
    expect(homeownerStatusLabel('pending')).toEqual({ label: 'Requested', tone: 'caution' });
    expect(homeownerStatusLabel('confirmed')).toEqual({ label: 'Confirmed', tone: 'secondary' });
    expect(homeownerStatusLabel('in_progress')).toEqual({ label: 'In progress', tone: 'default' });
    expect(homeownerStatusLabel('completed')).toEqual({ label: 'All done', tone: 'positive' });
    expect(homeownerStatusLabel('cancelled')).toEqual({ label: 'Cancelled', tone: 'critical' });
  });
});

describe('cleanerDisplayName', () => {
  it('returns first name + last initial', () => {
    expect(cleanerDisplayName(appt())).toBe('Marco D.');
  });
  it('returns null when no cleaner is assigned', () => {
    expect(cleanerDisplayName(appt({ cleaner_profile: null }))).toBeNull();
  });
});

describe('formatCleaningWhen', () => {
  it('formats a friendly date and 12h time', () => {
    expect(formatCleaningWhen('2026-06-25', '10:30')).toContain('Jun 25');
    expect(formatCleaningWhen('2026-06-25', '10:30')).toMatch(/10:30\s?AM/i);
  });
});

describe('recentCleaningTaskLabel', () => {
  it('says all done when every task is complete', () => {
    expect(recentCleaningTaskLabel(9, 9)).toBe('All 9 tasks done');
  });
  it('shows the fraction when partial', () => {
    expect(recentCleaningTaskLabel(6, 9)).toBe('6 of 9 tasks done');
  });
  it('returns null when there is no checklist', () => {
    expect(recentCleaningTaskLabel(0, 0)).toBeNull();
  });
});

describe('recentCleaningPaymentBadge', () => {
  it('marks a settled cleaning as Paid (positive)', () => {
    expect(recentCleaningPaymentBadge('paid')).toEqual({ label: 'Paid', tone: 'positive' });
  });
  it('flags a failed charge (critical)', () => {
    expect(recentCleaningPaymentBadge('failed')).toEqual({ label: 'Payment failed', tone: 'critical' });
  });
  it('defaults to Payment due for any unsettled or missing status', () => {
    expect(recentCleaningPaymentBadge(null)).toEqual({ label: 'Payment due', tone: 'caution' });
    expect(recentCleaningPaymentBadge('pending')).toEqual({ label: 'Payment due', tone: 'caution' });
  });
});
