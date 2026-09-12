import { describe, it, expect } from 'vitest';
import { isHMM, isYMD, parseOperatorBookingBody } from './parseOperatorBooking';

const ORG = '5f3a2b1c-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
const HOME = '11111111-1111-4111-8111-111111111111';
const PROP = '22222222-2222-4222-8222-222222222222';
const SVC = '33333333-3333-4333-8333-333333333333';
const CLEANER = '44444444-4444-4444-8444-444444444444';

const appointment = {
  homeowner_id: HOME,
  cleaner_id: null,
  property_id: PROP,
  service_type_id: SVC,
  checklist_id: null,
  scheduled_date: '2026-10-01',
  scheduled_time: '10:00',
  duration_minutes: 90,
  total_price: '150.5',
  price_override_enabled: false,
  price_override_total: null,
  special_requests: '  Gate code 1234 ',
  payment_method_id: 'pm_abc',
  is_self_pay: false,
  // fields the client also sends and the route ignores:
  organization_id: ORG,
  status: 'confirmed',
  cleaner_confirmation_status: 'accepted',
  response_deadline: '2020-01-01T00:00:00.000Z',
};
const slots = [{ slot_index: 0, scheduled_date: '2026-10-01', scheduled_time: '10:00' }];
const body = (a: Record<string, unknown> = {}, s: unknown = slots) => ({
  organization_id: ORG,
  appointment: { ...appointment, ...a },
  slots: s,
});

describe('isYMD / isHMM', () => {
  it('match the formats the booking form emits', () => {
    expect(isYMD('2026-10-01')).toBe(true);
    expect(isYMD('10/01/2026')).toBe(false);
    expect(isHMM('10:00')).toBe(true);
    expect(isHMM('10:00:00')).toBe(true);
    expect(isHMM('10am')).toBe(false);
  });
});

describe('parseOperatorBookingBody', () => {
  it('normalizes a valid customer-billed body and drops the ignored fields', () => {
    const r = parseOperatorBookingBody(body());
    expect(r).toEqual({
      ok: true,
      value: {
        organization_id: ORG,
        appointment: {
          homeowner_id: HOME,
          cleaner_id: null,
          property_id: PROP,
          service_type_id: SVC,
          checklist_id: null,
          scheduled_date: '2026-10-01',
          scheduled_time: '10:00',
          duration_minutes: 90,
          total_price: 150.5,
          price_override_enabled: false,
          price_override_total: null,
          special_requests: 'Gate code 1234',
          payment_method_id: 'pm_abc',
          is_self_pay: false,
        },
        slots,
      },
    });
  });

  it('forces payment_method_id to null on a self-pay booking and allows no customer', () => {
    const r = parseOperatorBookingBody(body({ is_self_pay: true, homeowner_id: null, cleaner_id: CLEANER }));
    expect(r.ok && r.value.appointment).toMatchObject({ is_self_pay: true, homeowner_id: null, payment_method_id: null, cleaner_id: CLEANER });
  });

  it('accepts up to three slots that start with the appointment time', () => {
    const three = [
      { slot_index: 0, scheduled_date: '2026-10-01', scheduled_time: '10:00' },
      { slot_index: 1, scheduled_date: '2026-10-02', scheduled_time: '13:00' },
      { slot_index: 2, scheduled_date: '2026-10-03', scheduled_time: '09:30' },
    ];
    expect(parseOperatorBookingBody(body({}, three))).toMatchObject({ ok: true, value: { slots: three } });
  });

  it.each([
    [{ organization_id: 'x' }, 'organization_id is required'],
    [{ appointment: null }, 'appointment is required'],
    [{ appointment: { ...appointment, property_id: null } }, 'A property is required'],
    [{ appointment: { ...appointment, service_type_id: 'svc' } }, 'A service is required'],
    [{ appointment: { ...appointment, checklist_id: 'x' } }, 'checklist_id must be an id'],
    [{ appointment: { ...appointment, is_self_pay: 'no' } }, 'is_self_pay must be true or false'],
    [{ appointment: { ...appointment, homeowner_id: null } }, 'A customer is required unless the company pays for this job'],
    [{ appointment: { ...appointment, scheduled_date: '10/01/2026' } }, 'scheduled_date must be YYYY-MM-DD'],
    [{ appointment: { ...appointment, scheduled_time: '10am' } }, 'scheduled_time must be HH:MM'],
    [{ appointment: { ...appointment, duration_minutes: 0 } }, 'Duration must be a whole number of minutes greater than 0'],
    [{ appointment: { ...appointment, total_price: -1 } }, 'Total price must be a number of 0 or more'],
    [{ appointment: { ...appointment, price_override_enabled: true, price_override_total: null } }, 'Price override amount is required'],
    [{ appointment: { ...appointment, payment_method_id: 7 } }, 'payment_method_id must be text'],
    [{ slots: [] }, 'slots must contain 1 to 3 offered times'],
    [{ slots: [slots[0], slots[0], slots[0], slots[0]] }, 'slots must contain 1 to 3 offered times'],
    [{ slots: [{ slot_index: 0, scheduled_date: 'x', scheduled_time: '10:00' }] }, 'each slot needs a valid scheduled_date (YYYY-MM-DD) and scheduled_time (HH:MM)'],
    [{ slots: [{ slot_index: 1, scheduled_date: '2026-10-01', scheduled_time: '10:00' }] }, 'slot_index must run from 0 in order'],
    [{ slots: [{ slot_index: 0, scheduled_date: '2026-10-02', scheduled_time: '10:00' }] }, 'The first slot must match the appointment date and time'],
  ] as const)('rejects %j', (override, error) => {
    expect(parseOperatorBookingBody({ ...body(), ...override })).toEqual({ ok: false, error });
  });

  it('rejects a non-object body', () => {
    expect(parseOperatorBookingBody('x')).toEqual({ ok: false, error: 'Request body must be a JSON object' });
  });
});
