import { money2 } from "./payments-presenters";

/** Coarse "how long has this been waiting" label; the queue is day-scale work. */
export function agoLabel(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type MarginTone = "positive" | "caution" | "critical";

/** Margin phrased as text + tone so the money story never rides on hue alone. */
export function marginLine(r: { marginCents: number; marginPct: number | null }): {
  text: string;
  tone: MarginTone;
} {
  if (r.marginCents < 0) {
    return {
      text: `Above job price by ${money2(Math.abs(r.marginCents) / 100)}`,
      tone: "critical",
    };
  }
  const pct = r.marginPct != null ? ` (${r.marginPct}%)` : "";
  return {
    text: `Leaves you ${money2(r.marginCents / 100)}${pct}`,
    tone: r.marginCents === 0 ? "caution" : "positive",
  };
}
