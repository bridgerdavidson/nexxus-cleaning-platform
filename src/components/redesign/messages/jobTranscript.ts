export interface JobTranscriptRowVM {
  id: string;
  /** cleaner = aligned to one side, homeowner = the other. */
  side: 'homeowner' | 'cleaner';
  senderName: string;
  content: string;
  timeLabel: string;   // "1:00 PM"
  dayLabel: string;    // "Today" / "Yesterday" / "Jun 29"
  showDayDivider: boolean;
}

interface TranscriptInput {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: { first_name?: string | null; last_name?: string | null; role?: string | null } | null;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Build a read-only, participant-labeled transcript of a homeowner<->cleaner job
 * thread for an OPERATOR (who is neither party). The cleaner's messages align to
 * one side, the homeowner's to the other, each labeled with the sender's name (or
 * a role fallback). Day dividers mark the first message and each day change.
 */
export function toJobTranscriptVM(
  messages: TranscriptInput[],
  opts: { cleanerId: string | null; now?: Date },
): JobTranscriptRowVM[] {
  const now = opts.now ?? new Date();
  let prevDay: number | null = null;
  return messages.map(m => {
    const d = new Date(m.created_at);
    const side: 'homeowner' | 'cleaner' =
      opts.cleanerId && m.sender_id === opts.cleanerId ? 'cleaner' : 'homeowner';
    const name = `${m.sender?.first_name ?? ''} ${m.sender?.last_name ?? ''}`.trim();
    const senderName = name || (side === 'cleaner' ? 'Cleaner' : 'Homeowner');
    const day = startOfDay(d);
    const showDayDivider = prevDay === null || day !== prevDay;
    prevDay = day;
    return {
      id: m.id,
      side,
      senderName,
      content: m.content,
      timeLabel: timeLabel(d),
      dayLabel: dayLabel(d, now),
      showDayDivider,
    };
  });
}
