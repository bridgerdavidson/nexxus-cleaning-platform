import { describe, it, expect } from 'vitest';
import { toJobTranscriptVM } from './jobTranscript';

// Pin the timezone: toJobTranscriptVM's day-divider / "Today" logic uses
// local-time day boundaries, so the absolute expectations below are only stable
// under a fixed zone. UTC matches CI's default; this keeps non-UTC dev machines
// passing too. (Set at module load, before any `it` runs the date math.)
process.env.TZ = 'UTC';

const NOW = new Date('2026-06-30T18:00:00Z');

function msg(over: Partial<Parameters<typeof toJobTranscriptVM>[0][number]> = {}) {
  return {
    id: 'm1',
    sender_id: 'home-1',
    content: 'hello',
    created_at: '2026-06-30T17:00:00Z',
    sender: { first_name: 'Hank', last_name: 'Homeowner', role: 'homeowner' },
    ...over,
  };
}

describe('toJobTranscriptVM', () => {
  it('sides a cleaner-sent message to the cleaner and others to the homeowner', () => {
    const rows = toJobTranscriptVM(
      [
        msg({ id: 'a', sender_id: 'home-1' }),
        msg({ id: 'b', sender_id: 'cln-1', sender: { first_name: 'Cara', last_name: 'Cleaner', role: 'cleaner' } }),
      ],
      { cleanerId: 'cln-1', now: NOW },
    );
    expect(rows.map(r => r.side)).toEqual(['homeowner', 'cleaner']);
    expect(rows[1].senderName).toBe('Cara Cleaner');
  });

  it('falls back to a role label when the sender profile has no name', () => {
    const rows = toJobTranscriptVM([msg({ sender: null })], { cleanerId: 'cln-1', now: NOW });
    expect(rows[0].senderName).toBe('Homeowner');
  });

  it('shows a day divider on the first message and when the day changes', () => {
    const rows = toJobTranscriptVM(
      [
        msg({ id: 'a', created_at: '2026-06-29T10:00:00Z' }),
        msg({ id: 'b', created_at: '2026-06-29T11:00:00Z' }),
        msg({ id: 'c', created_at: '2026-06-30T09:00:00Z' }),
      ],
      { cleanerId: 'cln-1', now: NOW },
    );
    expect(rows.map(r => r.showDayDivider)).toEqual([true, false, true]);
    expect(rows[2].dayLabel).toBe('Today');
  });
});
