import type { AnalyticsSummary, CancellationsData, InsightVM, LeaderRow, ServiceMixRow } from "./analytics-types";
import { pctDelta } from "./deriveAnalytics";

export function deriveInsights(input: {
  summary: AnalyticsSummary;
  serviceMix: ServiceMixRow[];
  leaderboard: LeaderRow[];
  cancellations: CancellationsData;
}): InsightVM[] {
  const { summary: s, serviceMix, leaderboard, cancellations: c } = input;
  const out: InsightVM[] = [];

  if (s.revenueCents != null && s.revenuePrevCents != null && s.revenuePrevCents > 0) {
    const d = pctDelta(s.revenueCents, s.revenuePrevCents);
    const top = serviceMix[0]?.name;
    if (d.dir !== "flat") {
      out.push({
        id: "rev", tone: d.tone === "good" ? "pos" : "warn", iconKey: "trend",
        text: `**Revenue ${d.dir === "up" ? "up" : "down"} ${d.label}** vs the previous period${top ? `, driven by **${top}**` : ""}.`,
      });
    }
  }

  const recur = (s.recurringCents ?? 0) + (s.oneoffCents ?? 0);
  if (recur > 0) {
    const share = Math.round(((s.recurringCents ?? 0) / recur) * 100);
    out.push({ id: "recur", tone: "brand", iconKey: "repeat", text: `**${share}% of revenue is recurring** repeat work, the predictable backbone.` });
  }

  if (c.total > 0 && c.rate > c.prevRate) {
    const topReason = c.byReason.find((r) => r.reason !== "not_recorded");
    out.push({ id: "cancel", tone: "warn", iconKey: "alert", text: `**Cancellations rose to ${(c.rate * 100).toFixed(1)}%**${topReason ? `, mostly ${topReason.reason.replace(/_/g, " ")}` : ""}.` });
  }

  if (leaderboard.length >= 1 && leaderboard[0].revenueCents != null) {
    const total = leaderboard.reduce((a, b) => a + (b.revenueCents ?? 0), 0);
    if (total > 0) {
      const share = Math.round((leaderboard[0].revenueCents! / total) * 100);
      if (share >= 25) out.push({ id: "lead", tone: "brand", iconKey: "users", text: `**${leaderboard[0].name}** drives ${share}% of revenue this period.` });
    }
  }

  return out.slice(0, 4);
}
