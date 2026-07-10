import { describe, it, expect } from 'vitest';
import type { AdminAppointment } from '@/hooks/useAdminData';
import { seedEditDetails } from './seedEditDetails';

// Minimal AdminAppointment fixture (mirrors reschedule/deriveReschedule.test.ts's mkAppt).
function mkAppt(overrides: Partial<AdminAppointment> = {}): AdminAppointment {
  const base: AdminAppointment = {
    id: 'apt-1',
    organization_id: 'org-1',
    service_type_id: 'svc-1',
    checklist_id: 'chk-1',
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
    checklist: null,
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

describe('seedEditDetails', () => {
  it('seeds override from the stored pair', () => {
    const s = seedEditDetails(
      mkAppt({ price_override_enabled: true, price_override_total: 250, total_price: 120 }),
    );
    expect(s).toMatchObject({ overrideEnabled: true, overrideTotal: 250 });
  });

  it('treats enabled=true with null total as override OFF seeded from total_price', () => {
    const s = seedEditDetails(
      mkAppt({ price_override_enabled: true, price_override_total: null, total_price: 120 }),
    );
    expect(s).toMatchObject({ overrideEnabled: false, overrideTotal: null });
  });

  it('treats enabled=false as override OFF regardless of a stale total', () => {
    const s = seedEditDetails(
      mkAppt({ price_override_enabled: false, price_override_total: 99, total_price: 120 }),
    );
    expect(s).toMatchObject({ overrideEnabled: false, overrideTotal: null });
  });

  it('carries service/checklist/requests/notes through', () => {
    const s = seedEditDetails(
      mkAppt({
        service_type_id: 'svc-9',
        checklist_id: 'chk-9',
        special_requests: 'Use the side gate',
        notes: 'Gate code 1234',
      }),
    );
    expect(s).toMatchObject({
      serviceTypeId: 'svc-9',
      checklistId: 'chk-9',
      specialRequests: 'Use the side gate',
      notes: 'Gate code 1234',
    });
  });

  it('defaults null checklist/requests/notes to empty/null form values', () => {
    const s = seedEditDetails(
      mkAppt({ checklist_id: null, special_requests: null, notes: null }),
    );
    expect(s).toMatchObject({ checklistId: null, specialRequests: '', notes: '' });
  });
});
