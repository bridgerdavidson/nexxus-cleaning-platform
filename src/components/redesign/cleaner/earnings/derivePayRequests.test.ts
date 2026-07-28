import { describe, it, expect } from 'vitest';
import { derivePayRequests, waitLabel } from './derivePayRequests';
import type { CleanerPayThread } from '@/hooks/useCleanerPayRequests';

const NOW = new Date('2026-07-28T12:00:00Z').getTime();

function thread(over: Partial<CleanerPayThread> = {}): CleanerPayThread {
  return {
    id: 'pr1',
    appointmentId: 'appt1',
    status: 'pending_org',
    currentOfferCents: 12000,
    approvedAmountCents: null,
    jobLabel: 'Standard clean',
    propertyLabel: 'Maple House',
    scheduledDate: '2026-07-27',
    updatedAt: '2026-07-28T09:00:00Z',
    offers: [
      {
        id: 'o1',
        actor: 'cleaner',
        amountCents: 12000,
        note: null,
        createdAt: '2026-07-28T09:00:00Z',
      },
    ],
    ...over,
  };
}

describe('waitLabel', () => {
  it('buckets by minutes, hours, then days', () => {
    expect(waitLabel('2026-07-28T11:59:30Z', NOW)).toBe('just now');
    expect(waitLabel('2026-07-28T11:20:00Z', NOW)).toBe('40m ago');
    expect(waitLabel('2026-07-28T08:00:00Z', NOW)).toBe('4h ago');
    expect(waitLabel('2026-07-26T12:00:00Z', NOW)).toBe('2d ago');
  });

  it('does not produce NaN for an unparseable timestamp', () => {
    expect(waitLabel('nonsense', NOW)).toBe('just now');
  });
});

describe('derivePayRequests', () => {
  it('splits by whose turn it is', () => {
    const b = derivePayRequests(
      [
        thread({ id: 'a', status: 'pending_org' }),
        thread({ id: 'b', status: 'pending_cleaner' }),
      ],
      NOW,
    );
    expect(b.awaiting.map((r) => r.id)).toEqual(['a']);
    expect(b.yourTurn.map((r) => r.id)).toEqual(['b']);
  });

  it('handles no threads', () => {
    expect(derivePayRequests(undefined, NOW)).toEqual({ awaiting: [], yourTurn: [], agreed: [] });
    expect(derivePayRequests([], NOW)).toEqual({ awaiting: [], yourTurn: [], agreed: [] });
  });

  it('reports the live amount and who offered it', () => {
    const b = derivePayRequests(
      [
        thread({
          status: 'pending_cleaner',
          currentOfferCents: 9000,
          offers: [
            {
              id: 'o1',
              actor: 'cleaner',
              amountCents: 12000,
              note: null,
              createdAt: '2026-07-28T09:00:00Z',
            },
            {
              id: 'o2',
              actor: 'org',
              amountCents: 9000,
              note: 'Standard rate for this size',
              createdAt: '2026-07-28T10:00:00Z',
            },
          ],
        }),
      ],
      NOW,
    );
    const row = b.yourTurn[0];
    expect(row.amountCents).toBe(9000);
    expect(row.offeredBy).toBe('org');
    expect(row.latestNote).toBe('Standard rate for this size');
    // Age comes off the LATEST offer, not the thread's first.
    expect(row.ageLabel).toBe('2h ago');
  });

  it('an agreed thread reports the APPROVED amount, not the last offer', () => {
    const b = derivePayRequests(
      [thread({ status: 'approved', currentOfferCents: 14000, approvedAmountCents: 14000 })],
      NOW,
    );
    expect(b.agreed).toHaveLength(1);
    expect(b.agreed[0].amountCents).toBe(14000);
    expect(b.awaiting).toHaveLength(0);
  });

  it('never surfaces a job price (the shape has no field for one)', () => {
    const b = derivePayRequests([thread()], NOW);
    expect(JSON.stringify(b)).not.toContain('jobPrice');
    expect(JSON.stringify(b)).not.toContain('price');
  });
});
