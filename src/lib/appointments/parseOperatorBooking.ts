import { asRecord, isUuid, parseMoney, parseOptionalText, type ParseResult } from '@/lib/catalog/parse';

export const MAX_BOOKING_SLOTS = 3;

export function isYMD(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
export function isHMM(s: unknown): s is string {
  return typeof s === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

export interface BookingSlotInput {
  slot_index: number;
  scheduled_date: string;
  scheduled_time: string;
}

/** The subset of buildBookingInsert's `appointment` the route accepts. Everything else is ignored. */
export interface OperatorAppointmentInput {
  homeowner_id: string | null;
  cleaner_id: string | null;
  property_id: string;
  service_type_id: string;
  checklist_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  total_price: number;
  price_override_enabled: boolean;
  price_override_total: number | null;
  special_requests: string | null;
  payment_method_id: string | null;
  is_self_pay: boolean;
}

export interface OperatorBookingInput {
  organization_id: string;
  appointment: OperatorAppointmentInput;
  slots: BookingSlotInput[];
}

function optionalUuid(v: unknown, label: string): ParseResult<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (!isUuid(v)) return { ok: false, error: `${label} must be an id` };
  return { ok: true, value: v };
}

function parseSlots(v: unknown, first: { scheduled_date: string; scheduled_time: string }): ParseResult<BookingSlotInput[]> {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_BOOKING_SLOTS) {
    return { ok: false, error: `slots must contain 1 to ${MAX_BOOKING_SLOTS} offered times` };
  }
  const out: BookingSlotInput[] = [];
  for (const [idx, raw] of v.entries()) {
    const s = asRecord(raw);
    if (!s || !isYMD(s.scheduled_date) || !isHMM(s.scheduled_time)) {
      return { ok: false, error: 'each slot needs a valid scheduled_date (YYYY-MM-DD) and scheduled_time (HH:MM)' };
    }
    if (s.slot_index !== idx) return { ok: false, error: 'slot_index must run from 0 in order' };
    out.push({ slot_index: idx, scheduled_date: s.scheduled_date, scheduled_time: s.scheduled_time });
  }
  if (out[0].scheduled_date !== first.scheduled_date || out[0].scheduled_time !== first.scheduled_time) {
    return { ok: false, error: 'The first slot must match the appointment date and time' };
  }
  return { ok: true, value: out };
}

export function parseOperatorBookingBody(body: unknown): ParseResult<OperatorBookingInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  if (!isUuid(r.organization_id)) return { ok: false, error: 'organization_id is required' };
  const a = asRecord(r.appointment);
  if (!a) return { ok: false, error: 'appointment is required' };

  if (!isUuid(a.property_id)) return { ok: false, error: 'A property is required' };
  if (!isUuid(a.service_type_id)) return { ok: false, error: 'A service is required' };
  const checklistId = optionalUuid(a.checklist_id, 'checklist_id');
  if (!checklistId.ok) return checklistId;
  const homeownerId = optionalUuid(a.homeowner_id, 'homeowner_id');
  if (!homeownerId.ok) return homeownerId;
  const cleanerId = optionalUuid(a.cleaner_id, 'cleaner_id');
  if (!cleanerId.ok) return cleanerId;

  if (typeof a.is_self_pay !== 'boolean') return { ok: false, error: 'is_self_pay must be true or false' };
  if (!a.is_self_pay && !homeownerId.value) {
    return { ok: false, error: 'A customer is required unless the company pays for this job' };
  }

  if (!isYMD(a.scheduled_date)) return { ok: false, error: 'scheduled_date must be YYYY-MM-DD' };
  if (!isHMM(a.scheduled_time)) return { ok: false, error: 'scheduled_time must be HH:MM' };
  const duration = typeof a.duration_minutes === 'string' ? Number(a.duration_minutes) : a.duration_minutes;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0) {
    return { ok: false, error: 'Duration must be a whole number of minutes greater than 0' };
  }
  const totalPrice = parseMoney(a.total_price, 'Total price');
  if (!totalPrice.ok) return totalPrice;

  if (typeof a.price_override_enabled !== 'boolean') {
    return { ok: false, error: 'price_override_enabled must be true or false' };
  }
  let overrideTotal: number | null = null;
  if (a.price_override_total !== undefined && a.price_override_total !== null) {
    const p = parseMoney(a.price_override_total, 'Price override');
    if (!p.ok) return p;
    overrideTotal = p.value;
  }
  if (a.price_override_enabled && overrideTotal === null) {
    return { ok: false, error: 'Price override amount is required' };
  }

  const special = parseOptionalText(a.special_requests, 'Special requests');
  if (!special.ok) return special;

  let paymentMethodId: string | null = null;
  if (!a.is_self_pay && a.payment_method_id !== undefined && a.payment_method_id !== null) {
    if (typeof a.payment_method_id !== 'string') return { ok: false, error: 'payment_method_id must be text' };
    paymentMethodId = a.payment_method_id.trim() || null;
  }

  const slots = parseSlots(r.slots, { scheduled_date: a.scheduled_date, scheduled_time: a.scheduled_time });
  if (!slots.ok) return slots;

  return {
    ok: true,
    value: {
      organization_id: r.organization_id,
      appointment: {
        homeowner_id: homeownerId.value,
        cleaner_id: cleanerId.value,
        property_id: a.property_id,
        service_type_id: a.service_type_id,
        checklist_id: checklistId.value,
        scheduled_date: a.scheduled_date,
        scheduled_time: a.scheduled_time,
        duration_minutes: duration,
        total_price: totalPrice.value,
        price_override_enabled: a.price_override_enabled,
        price_override_total: overrideTotal,
        special_requests: special.value,
        payment_method_id: paymentMethodId,
        is_self_pay: a.is_self_pay,
      },
      slots: slots.value,
    },
  };
}
