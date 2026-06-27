"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, MapPin, Navigation, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import type { CleanerAppointment, DeclineReason } from "@/hooks/useCleanerData";
import {
  propertyTitle, customerLabel, propertyAddress, mapsUrl, jobSubtitle,
  formatDateLong, formatTimeParts, formatDuration,
} from "../shared/job-presenters";
import { CleanerJobBadge } from "../shared/CleanerJobBadge";
import { OfferActionsBar } from "../shared/OfferActionsBar";
import { deriveJobActionMode } from "./deriveJobDetail";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function CleanerJobDetailOverlay({
  appointment, loading, onClosed, onStart, starting, onContinue, onAcceptOffer, onDeclineOffer,
}: {
  appointment: CleanerAppointment | null;
  loading: boolean;
  onClosed: () => void;
  onStart: () => Promise<unknown> | void;
  starting: boolean;
  onContinue: () => void;
  onAcceptOffer: (slotIndex: number) => Promise<unknown> | void;
  onDeclineOffer: (reason: DeclineReason, other?: string) => Promise<unknown> | void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const closingRef = useRef(false);
  const closeRef = useRef<() => void>(() => {});

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setShown(false);
    setTimeout(onClosed, 300);
  }
  closeRef.current = close;

  // Enter animation on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Mount-only: lock body scroll, focus the panel, bind Escape. Must be
  // mount-only so re-renders never steal focus (matches MobileThreadOverlay).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    // Skip when a nested layer (the vaul/Radix decline drawer) already consumed
    // Escape; Radix calls preventDefault on dismiss, so the takeover only closes
    // when nothing else handled the key.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, []);

  async function handleStart() {
    try { await onStart(); close(); } catch { /* toast handled by hook */ }
  }

  const mode = appointment ? deriveJobActionMode(appointment) : "none";
  const addr = appointment ? propertyAddress(appointment) : null;
  const maps = appointment ? mapsUrl(appointment) : null;
  const duration = appointment ? formatDuration(appointment.service_type?.duration_minutes) : null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Job details"
      tabIndex={-1}
      className={`redesign-overlay fixed inset-0 z-50 flex flex-col bg-card outline-none transition-transform duration-300 ease-out motion-reduce:transition-none ${shown ? "translate-x-0" : "translate-x-full"}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)]">
        <button
          onClick={() => closeRef.current()}
          aria-label="Back"
          className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-6" />
        </button>
        <div className="min-w-0 flex-1 py-2">
          {appointment ? (
            <>
              <div className="truncate text-sm font-bold">{propertyTitle(appointment)}</div>
              <div className="truncate text-xs text-muted-foreground">{jobSubtitle(appointment)}</div>
            </>
          ) : (
            <div className="text-sm font-bold">Job</div>
          )}
        </div>
        {appointment && <CleanerJobBadge appointment={appointment} />}
        <div className="w-1" />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-lg space-y-5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          {loading && !appointment ? (
            <>
              <Skeleton className="h-16 w-full rounded-card" />
              <Skeleton className="h-16 w-full rounded-card" />
              <Skeleton className="h-16 w-full rounded-card" />
            </>
          ) : !appointment ? (
            <div className="pt-10">
              <EmptyState icon={<MapPin />} title="Job not available" description="This job may have been reassigned or is no longer on your schedule." />
            </div>
          ) : (
            <>
              <Field label="When">
                <div className="font-semibold">{formatDateLong(appointment.scheduled_date)}</div>
                <div className="text-muted-foreground">
                  {formatTimeParts(appointment.scheduled_time).h} {formatTimeParts(appointment.scheduled_time).ap}
                  {duration ? ` · ${duration}` : ""}
                </div>
              </Field>
              <Separator />
              <Field label="Where">
                <div className="font-semibold">{propertyTitle(appointment)}</div>
                {addr && <div className="text-muted-foreground">{addr}</div>}
                {maps && (
                  <a href={maps} target="_blank" rel="noopener noreferrer"
                     className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-control py-2 text-sm font-semibold text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Navigation className="size-4" /> Directions
                  </a>
                )}
              </Field>
              <Separator />
              <Field label="Customer">{customerLabel(appointment)}</Field>
              <Separator />
              <Field label="Service">
                <div className="font-semibold">{appointment.service_type?.name || "Cleaning"}</div>
                {appointment.checklist?.name && <div className="text-muted-foreground">{appointment.checklist.name}</div>}
              </Field>
              {appointment.special_requests && (<><Separator /><Field label="Special requests">{appointment.special_requests}</Field></>)}
            </>
          )}
        </div>
      </div>

      {/* Action bar */}
      {appointment && mode !== "none" && (
        <div
          className="border-t border-border bg-card px-5 pt-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <div className="mx-auto w-full max-w-lg">
            {mode === "offer" && (
              <OfferActionsBar appointment={appointment} layout="stacked" onDone={() => close()}
                onAccept={onAcceptOffer} onDecline={onDeclineOffer} />
            )}
            {mode === "start" && (
              <Button onClick={handleStart} loading={starting} className="w-full" size="lg"><Play /> Start job</Button>
            )}
            {mode === "continue" && (
              <Button onClick={onContinue} className="w-full" size="lg"><ArrowRight /> Continue job</Button>
            )}
            {mode === "done" && (
              <div className="py-1 text-center text-sm font-semibold text-positive-700">This job is complete.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
