"use client";

import { useState } from "react";
import { CalendarClock, Check, Clock, ListChecks, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeclineReason } from "@/hooks/useCleanerData";
import type { SeriesOffer } from "./deriveSeriesOffers";
import { propertyTitle, jobSubtitle, formatRespondBy } from "../shared/job-presenters";
import { SeriesOfferSheet } from "./SeriesOfferSheet";

/** "Jul 20" from a YYYY-MM-DD string (local, month + day). */
function monthDay(ymd: string): string {
  const [y, m, d] = (ymd ?? "").split("-").map(Number);
  if (!y || !m || !d) return ymd ?? "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Jul 20 to Sep 14", or a single date when start === end. */
function seriesRange(start: string, end: string): string {
  return start === end ? monthDay(start) : `${monthDay(start)} to ${monthDay(end)}`;
}

export function SeriesOfferCard({
  series, onAcceptAll, onDeclineAll, onAcceptOne, onDeclineOne,
}: {
  series: SeriesOffer;
  onAcceptAll: (seriesId: string) => Promise<unknown> | void;
  onDeclineAll: (seriesId: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
  onAcceptOne: (appointmentId: string, slotIndex: number) => Promise<unknown> | void;
  onDeclineOne: (appointmentId: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"list" | "declineAll">("list");
  // One busy flag per bulk action so the sheet + card show the right spinner,
  // whichever surface triggered it.
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const respondBy = formatRespondBy(series.soonestDeadline);

  async function wrappedAcceptAll(seriesId: string) {
    setBusy("accept");
    try { return await onAcceptAll(seriesId); }
    finally { setBusy(null); }
  }
  async function wrappedDeclineAll(seriesId: string, reason: DeclineReason, other?: string) {
    setBusy("decline");
    try { return await onDeclineAll(seriesId, reason, other); }
    finally { setBusy(null); }
  }
  function openPickDates() { setSheetMode("list"); setSheetOpen(true); }
  function openDeclineAll() { setSheetMode("declineAll"); setSheetOpen(true); }

  async function acceptAllFromCard() {
    try { await wrappedAcceptAll(series.seriesId); }
    catch { /* toast handled by hook */ }
  }

  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <CalendarClock className="size-4 text-brand-600" aria-hidden />
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-brand-700">Repeating cleaning</span>
          </div>
          <div className="mt-1 text-sm font-extrabold">{propertyTitle(series.first)}</div>
          <div className="text-xs text-muted-foreground">{jobSubtitle(series.first)}</div>
        </div>
        {respondBy && <Badge variant="caution"><Clock />{respondBy}</Badge>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{series.count} cleanings</Badge>
        <span className="text-xs font-medium text-muted-foreground">{seriesRange(series.startDate, series.endDate)}</span>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        The office offered you this repeating cleaning. Take all of it, just the dates that work, or decline them all.
      </p>

      <div className="mt-3 flex gap-2">
        <Button onClick={acceptAllFromCard} loading={busy === "accept"} disabled={busy !== null} className="flex-1">
          <Check /> Accept all {series.count}
        </Button>
        <Button variant="outline" onClick={openPickDates} disabled={busy !== null} className="flex-1">
          <ListChecks /> Pick dates
        </Button>
      </div>
      <Button
        variant="ghost"
        onClick={openDeclineAll}
        disabled={busy !== null}
        className="mt-1 w-full text-critical-700 hover:text-critical-700"
      >
        <X /> Decline all
      </Button>

      <SeriesOfferSheet
        series={series}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialMode={sheetMode}
        onAcceptAll={wrappedAcceptAll}
        onDeclineAll={wrappedDeclineAll}
        onAcceptOne={onAcceptOne}
        onDeclineOne={onDeclineOne}
        accepting={busy === "accept"}
        declining={busy === "decline"}
      />
    </div>
  );
}
