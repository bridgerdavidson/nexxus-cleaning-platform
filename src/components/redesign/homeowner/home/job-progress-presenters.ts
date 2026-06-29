export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function formatElapsed(startIso: string | null, nowMs: number): string | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return null;
  const mins = Math.floor((nowMs - start) / 60_000);
  if (mins < 1) return 'just started';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function stageLabel(stage: string | null | undefined): string {
  switch (stage) {
    case 'not_started':
    case 'before_photos':
      return 'Getting started';
    case 'after_photos':
      return 'Finishing up';
    case 'completed':
      return 'All done';
    case 'checklist':
    default:
      return 'Cleaning in progress';
  }
}
