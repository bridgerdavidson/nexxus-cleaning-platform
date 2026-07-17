import { describe, it, expect } from 'vitest';
import { selectStrandedUnwindCandidates, type StrandedUnwindEventRow } from './reconcile';

function failure(
  appointmentId: string,
  createdAt: string,
  extra: Partial<StrandedUnwindEventRow> = {},
): StrandedUnwindEventRow {
  return {
    appointment_id: appointmentId,
    organization_id: 'org-1',
    payment_id: 'pay-1',
    created_at: createdAt,
    ...extra,
  };
}

describe('selectStrandedUnwindCandidates', () => {
  it('keeps an appointment with failures and no recovery marker', () => {
    const out = selectStrandedUnwindCandidates([failure('a', '2026-07-17T10:00:00Z')], []);
    expect(out).toHaveLength(1);
    expect(out[0].appointment_id).toBe('a');
  });

  it('dedupes to one candidate per appointment, keeping the newest failure row', () => {
    const out = selectStrandedUnwindCandidates(
      [
        failure('a', '2026-07-17T10:00:00Z', { payment_id: 'pay-old' }),
        failure('a', '2026-07-17T12:00:00Z', { payment_id: 'pay-new' }),
        failure('b', '2026-07-17T11:00:00Z'),
      ],
      [],
    );
    expect(out).toHaveLength(2);
    expect(out.find((c) => c.appointment_id === 'a')?.payment_id).toBe('pay-new');
  });

  it('drops an appointment whose recovery marker is newer than its newest failure', () => {
    const out = selectStrandedUnwindCandidates(
      [failure('a', '2026-07-17T10:00:00Z')],
      [{ appointment_id: 'a', created_at: '2026-07-17T10:30:00Z' }],
    );
    expect(out).toHaveLength(0);
  });

  it('keeps an appointment whose newest failure postdates its recovery (a later refund failed again)', () => {
    const out = selectStrandedUnwindCandidates(
      [failure('a', '2026-07-17T10:00:00Z'), failure('a', '2026-07-17T14:00:00Z')],
      [{ appointment_id: 'a', created_at: '2026-07-17T11:00:00Z' }],
    );
    expect(out).toHaveLength(1);
  });

  it('retries on an exact failure/recovery timestamp tie (worst case: one idempotent no-op)', () => {
    const out = selectStrandedUnwindCandidates(
      [failure('a', '2026-07-17T10:00:00Z')],
      [{ appointment_id: 'a', created_at: '2026-07-17T10:00:00Z' }],
    );
    expect(out).toHaveLength(1);
  });

  it('only compares recoveries against their own appointment', () => {
    const out = selectStrandedUnwindCandidates(
      [failure('a', '2026-07-17T10:00:00Z'), failure('b', '2026-07-17T10:00:00Z')],
      [{ appointment_id: 'b', created_at: '2026-07-17T12:00:00Z' }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].appointment_id).toBe('a');
  });
});
