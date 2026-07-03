import { describe, it, expect } from 'vitest';
import type { ServiceType } from '@/hooks/useServices';
import { buildBookingInsert } from './buildBookingInsert';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';

const svc = { id: 's1', base_price: 150, duration_minutes: 120 } as ServiceType;

const base = (over: Partial<OperatorBookingState> = {}): OperatorBookingState => ({
  ...EMPTY_OPERATOR_BOOKING,
  customerId: 'c1',
  propertyId: 'p1',
  serviceTypeId: 's1',
  checklistId: 'cl1',
  cleanerId: 'cleaner1',
  slots: [
    { date: '2026-07-05', time: '10:00' },
    { date: '2026-07-06', time: '13:00' },
  ],
  ...over,
});

describe('buildBookingInsert', () => {
  it('builds a customer-billed appointment with a card + slots', () => {
    const { appointment, slots } = buildBookingInsert('org1', base({ paymentValue: 'pm_123' }), svc, '2026-07-04T10:00:00Z');
    expect(appointment).toMatchObject({
      organization_id: 'org1',
      homeowner_id: 'c1',
      cleaner_id: 'cleaner1',
      property_id: 'p1',
      service_type_id: 's1',
      checklist_id: 'cl1',
      scheduled_date: '2026-07-05',
      scheduled_time: '10:00',
      duration_minutes: 120,
      total_price: 150,
      price_override_enabled: false,
      price_override_total: null,
      payment_method_id: 'pm_123',
      is_self_pay: false,
      status: 'pending',
      cleaner_confirmation_status: 'awaiting',
      response_deadline: '2026-07-04T10:00:00Z',
    });
    expect(slots).toEqual([
      { slot_index: 0, scheduled_date: '2026-07-05', scheduled_time: '10:00' },
      { slot_index: 1, scheduled_date: '2026-07-06', scheduled_time: '13:00' },
    ]);
  });

  it('drops a non-card payment selection (send-link/defer) to null', () => {
    const { appointment } = buildBookingInsert('org1', base({ paymentValue: 'send-link' }), svc, null);
    expect(appointment.payment_method_id).toBeNull();
  });

  it('applies a price override', () => {
    const { appointment } = buildBookingInsert('org1', base({ priceOverride: 175 }), svc, null);
    expect(appointment.total_price).toBe(175);
    expect(appointment.price_override_enabled).toBe(true);
    expect(appointment.price_override_total).toBe(175);
  });

  it('self-pay org-owned: homeowner_id + payment_method_id null, is_self_pay true', () => {
    const { appointment } = buildBookingInsert(
      'org1',
      base({ billTo: 'self_pay', customerId: null, paymentValue: 'pm_123' }),
      svc,
      null,
    );
    expect(appointment.homeowner_id).toBeNull();
    expect(appointment.payment_method_id).toBeNull();
    expect(appointment.is_self_pay).toBe(true);
  });
});
