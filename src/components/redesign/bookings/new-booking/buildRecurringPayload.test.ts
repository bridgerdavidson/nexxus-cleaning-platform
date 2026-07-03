import { describe, it, expect } from 'vitest';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';
import { buildRecurringPayload } from './buildRecurringPayload';
import type { ServiceType } from '@/hooks/useServices';

const service = {
  id: 'svc-1',
  name: 'Regular Cleaning',
  base_price: 150,
  duration_minutes: 120,
  is_active: true,
} as ServiceType;
const MON = '2026-07-20';

function baseState(
  partial: Partial<OperatorBookingState['recurrence']>,
  over?: Partial<OperatorBookingState>,
): OperatorBookingState {
  return {
    ...EMPTY_OPERATOR_BOOKING,
    customerId: 'home-1',
    propertyId: 'prop-1',
    serviceTypeId: 'svc-1',
    checklistId: 'chk-1',
    cleanerId: 'clnr-1',
    slots: [{ date: MON, time: '10:00' }],
    notes: '  wipe the fridge  ',
    ...over,
    recurrence: { ...EMPTY_OPERATOR_BOOKING.recurrence, enabled: true, ...partial },
  };
}

describe('buildRecurringPayload', () => {
  it('weekly preset, after N -> maxOccurrences set, endDate null, weekly daysOfWeek from start', () => {
    const p = buildRecurringPayload('org-1', baseState({ preset: 'weekly', end: 'after', count: 6 }), service);
    expect(p).toMatchObject({
      organizationId: 'org-1',
      homeownerId: 'home-1',
      cleanerId: 'clnr-1',
      propertyId: 'prop-1',
      serviceTypeId: 'svc-1',
      checklistId: 'chk-1',
      startDate: MON,
      startTime: '10:00',
      durationMinutes: 120,
      totalPrice: 150,
      recurrenceType: 'weekly',
      interval: 1,
      daysOfWeek: [1],
      endDate: null,
      maxOccurrences: 6,
      specialRequests: 'wipe the fridge',
      status: 'pending',
      priceOverrideEnabled: false,
      priceOverrideTotal: null,
    });
  });
  it('biweekly on-date end -> interval 2, endDate set, maxOccurrences null', () => {
    const p = buildRecurringPayload(
      'org-1',
      baseState({ preset: 'biweekly', end: 'on_date', endDate: '2026-09-01' }),
      service,
    );
    expect(p.interval).toBe(2);
    expect(p.endDate).toBe('2026-09-01');
    expect(p.maxOccurrences).toBeNull();
  });
  it('custom monthly -> daysOfWeek undefined', () => {
    const p = buildRecurringPayload(
      'org-1',
      baseState({ preset: 'custom', customType: 'monthly', customInterval: 1, end: 'keep_going' }),
      service,
    );
    expect(p.recurrenceType).toBe('monthly');
    expect(p.daysOfWeek).toBeUndefined();
    expect(p.endDate).toBeNull();
    expect(p.maxOccurrences).toBeNull();
  });
  it('price override flows through', () => {
    const p = buildRecurringPayload(
      'org-1',
      baseState({ preset: 'weekly', end: 'after', count: 4 }, { priceOverride: 199 }),
      service,
    );
    expect(p).toMatchObject({ totalPrice: 199, priceOverrideEnabled: true, priceOverrideTotal: 199 });
  });
  it('paymentMethodId is a concrete card only', () => {
    const withCard = buildRecurringPayload('org-1', baseState({}, { paymentValue: 'pm_abc' }), service);
    expect(withCard.paymentMethodId).toBe('pm_abc');
    const deferred = buildRecurringPayload('org-1', baseState({}, { paymentValue: 'defer' }), service);
    expect(deferred.paymentMethodId).toBeNull();
  });
  it('empty notes -> null specialRequests', () => {
    const p = buildRecurringPayload('org-1', baseState({}, { notes: '   ' }), service);
    expect(p.specialRequests).toBeNull();
  });
});
