import { describe, it, expect } from 'vitest';
import { findConflicts, type ScheduleAppointment } from './appointmentConflicts';

const apt = (overrides: Partial<ScheduleAppointment>): ScheduleAppointment => ({
  id: 'a1',
  status: 'confirmed',
  scheduled_date: '2026-05-20',
  scheduled_time: '10:00',
  duration_minutes: 60,
  ...overrides,
});

describe('findConflicts', () => {
  it('returns the overlapping appointment when times overlap exactly', () => {
    const existing = [apt({ id: 'x1' })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(1);
  });

  it('returns the appointment when candidate starts mid-way through it', () => {
    const existing = [apt({ id: 'x1', scheduled_time: '09:30', duration_minutes: 60 })];
    // existing: 09:30–10:30; candidate 10:00–11:00 → overlaps 10:00–10:30
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(1);
  });

  it('does NOT flag back-to-back (end exactly = start)', () => {
    const existing = [apt({ id: 'x1', scheduled_time: '09:00', duration_minutes: 60 })];
    // existing: 09:00–10:00; candidate 10:00–11:00 — touches, doesn't overlap
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(0);
  });

  it('ignores cancelled appointments', () => {
    const existing = [apt({ id: 'x1', status: 'cancelled' })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(0);
  });

  it('ignores completed appointments', () => {
    const existing = [apt({ id: 'x1', status: 'completed' })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(0);
  });

  it('ignores appointments on a different date', () => {
    const existing = [apt({ id: 'x1', scheduled_date: '2026-05-21' })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(0);
  });

  it('returns multiple conflicts when several overlap', () => {
    const existing = [
      apt({ id: 'x1', scheduled_time: '09:45', duration_minutes: 30 }), // 09:45–10:15
      apt({ id: 'x2', scheduled_time: '10:30', duration_minutes: 30 }), // 10:30–11:00 ← overlaps 10:00–11:00? yes (10:30–11:00 vs 10:00–11:00)
    ];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(2);
  });

  it('excludes the appointment being edited via excludeAppointmentId', () => {
    const existing = [apt({ id: 'edited' })];
    expect(
      findConflicts(
        existing,
        { date: '2026-05-20', time: '10:00', durationMinutes: 60 },
        { excludeAppointmentId: 'edited' },
      ),
    ).toHaveLength(0);
  });

  it('flags partial overlap when candidate starts 30min into an existing booking (user-reported scenario)', () => {
    // Existing: 4:00pm–5:00pm (Wanda already booked at 4pm)
    // Candidate: 4:30pm for 60min → 4:30pm–5:30pm. Should warn.
    const existing = [apt({ id: 'wanda-4pm', scheduled_time: '16:00', duration_minutes: 60 })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '16:30',
        durationMinutes: 60,
      }),
    ).toHaveLength(1);
  });

  it('flags partial overlap when candidate ENDS during an existing booking', () => {
    // Existing 4:00pm–5:00pm. Candidate 3:30pm–4:30pm → overlaps 4:00–4:30.
    const existing = [apt({ id: 'wanda-4pm', scheduled_time: '16:00', duration_minutes: 60 })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '15:30',
        durationMinutes: 60,
      }),
    ).toHaveLength(1);
  });

  it('flags overlap when candidate fully contains an existing short booking', () => {
    // Existing 4:30pm–4:45pm. Candidate 4:00pm–5:00pm → fully contains it.
    const existing = [apt({ id: 'wanda-short', scheduled_time: '16:30', duration_minutes: 15 })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '16:00',
        durationMinutes: 60,
      }),
    ).toHaveLength(1);
  });

  it('handles HH:mm:ss times on existing appointments', () => {
    const existing = [apt({ id: 'x1', scheduled_time: '10:00:00' })];
    expect(
      findConflicts(existing, {
        date: '2026-05-20',
        time: '10:30',
        durationMinutes: 60,
      }),
    ).toHaveLength(1);
  });

  it('returns empty when candidate time is unparseable', () => {
    expect(
      findConflicts([apt({})], {
        date: '2026-05-20',
        time: 'oops',
        durationMinutes: 60,
      }),
    ).toEqual([]);
  });
});
