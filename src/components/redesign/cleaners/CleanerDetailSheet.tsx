"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  Phone,
  CalendarDays,
  Pencil,
  Trash2,
  Ban,
  RotateCcw,
  CreditCard,
  AlertTriangle,
  ShieldCheck,
  BadgeCheck,
  CheckCircle2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { CleanerStatusBadge, ConnectBadge } from "./cleaners-presenters";
import type { CleanerDetailVM, CleanerUpcomingVM, ConnectState } from "./cleaners-types";

export type CleanerSaveFields = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  payout_percent: number;
  hourly_rate: number | null;
  experience_years: number | null;
};

export type CleanerDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: CleanerDetailVM | null;
  upcoming: CleanerUpcomingVM[];
  detailsLoading: boolean;
  canViewPayments: boolean;
  canEdit: boolean;
  busy?: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Returns true on success so the sheet can exit edit mode. */
  onSave: (fields: CleanerSaveFields) => Promise<boolean>;
  onDeactivate: () => void;
  onReactivate: () => void;
  onRemove: () => void;
};

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-border bg-muted/30 px-3 py-2 text-center">
      <div className="text-lg font-bold tnum text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-control" />
      ))}
    </div>
  );
}

const CONNECT_LINE: Record<ConnectState, string> = {
  ready: "Stripe payout setup complete",
  incomplete: "Stripe payout setup not finished",
  none: "No Stripe payout account yet",
};

function VerificationBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "positive" : "secondary"} className="whitespace-nowrap">
      {ok ? <BadgeCheck /> : <ShieldCheck />}
      {label}
    </Badge>
  );
}

function num(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function CleanerDetailSheet({
  open,
  onOpenChange,
  detail,
  upcoming,
  detailsLoading,
  canViewPayments,
  canEdit,
  busy,
  editing,
  onEditingChange,
  onSave,
  onDeactivate,
  onReactivate,
  onRemove,
}: CleanerDetailSheetProps) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    payoutPercent: "",
    hourlyRate: "",
    experienceYears: "",
  });

  // Reset the edit form whenever a different cleaner opens or edit mode begins.
  useEffect(() => {
    if (detail) {
      setForm({
        firstName: detail.firstName,
        lastName: detail.lastName,
        email: detail.email,
        phone: detail.phone ?? "",
        payoutPercent: String(detail.payoutPercent ?? ""),
        hourlyRate: detail.hourlyRate == null ? "" : String(detail.hourlyRate),
        experienceYears: detail.experienceYears == null ? "" : String(detail.experienceYears),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, editing]);

  const save = async () => {
    const ok = await onSave({
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      payout_percent: num(form.payoutPercent) ?? 0,
      hourly_rate: num(form.hourlyRate),
      experience_years: num(form.experienceYears),
    });
    if (ok) onEditingChange(false);
  };

  const sc = detail?.scorecard;
  const ph = detail?.payoutHealthDetail;
  const benched = detail?.status === "benched";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {detail ? (
          <>
            <SheetHeader className="pr-12">
              <div className="flex items-center gap-3">
                <Avatar className="size-12">
                  {detail.avatarUrl ? <AvatarImage src={detail.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{detail.initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{detail.name}</SheetTitle>
                  <SheetDescription>Cleaner</SheetDescription>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <CleanerStatusBadge status={detail.status} />
                    <ConnectBadge state={detail.connect} />
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
              {editing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="First name" htmlFor="cl-first">
                      <Input
                        id="cl-first"
                        value={form.firstName}
                        onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Last name" htmlFor="cl-last">
                      <Input
                        id="cl-last"
                        value={form.lastName}
                        onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                      />
                    </FormField>
                  </div>
                  <FormField label="Email" htmlFor="cl-email">
                    <Input
                      id="cl-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Phone" htmlFor="cl-phone" helper="Optional">
                    <Input
                      id="cl-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Payout %" htmlFor="cl-payout" helper="Cut of each job">
                      <Input
                        id="cl-payout"
                        type="number"
                        inputMode="decimal"
                        value={form.payoutPercent}
                        onChange={(e) => setForm((f) => ({ ...f, payoutPercent: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Hourly rate" htmlFor="cl-rate" helper="Optional">
                      <Input
                        id="cl-rate"
                        type="number"
                        inputMode="decimal"
                        value={form.hourlyRate}
                        onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                      />
                    </FormField>
                  </div>
                  <FormField label="Experience (years)" htmlFor="cl-exp" helper="Optional">
                    <Input
                      id="cl-exp"
                      type="number"
                      inputMode="numeric"
                      value={form.experienceYears}
                      onChange={(e) => setForm((f) => ({ ...f, experienceYears: e.target.value }))}
                    />
                  </FormField>
                  <div className="flex gap-2">
                    <Button onClick={() => void save()} loading={busy}>
                      Save changes
                    </Button>
                    <Button variant="secondary" onClick={() => onEditingChange(false)} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Performance scorecard */}
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      Performance
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <StatBox label="Completed" value={String(sc?.completedJobs ?? 0)} />
                      <StatBox label="Completion rate" value={sc?.completionRateLabel ?? "N/A"} />
                      <StatBox label="Upcoming" value={String(sc?.upcomingJobs ?? 0)} />
                      <StatBox label="Done this week" value={String(sc?.completedThisWeek ?? 0)} />
                      {canViewPayments ? (
                        <>
                          <StatBox label="Lifetime earnings" value={sc?.lifetimeEarningsLabel ?? "$0"} />
                          <StatBox label="Pending owed" value={sc?.pendingOwedLabel ?? "$0"} />
                        </>
                      ) : null}
                    </div>
                    <div className="rounded-control border border-dashed border-border px-3 py-2 text-center text-xs text-muted-foreground">
                      {sc?.ratingLabel ?? "No ratings yet"}
                    </div>
                  </section>

                  <Separator />

                  {/* Contact */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="size-4 shrink-0 text-muted-foreground" />
                      <a href={`mailto:${detail.email}`} className="truncate text-foreground hover:underline">
                        {detail.email}
                      </a>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="size-4 shrink-0 text-muted-foreground" />
                      {detail.phone ? (
                        <a href={`tel:${detail.phone}`} className="text-foreground hover:underline">
                          {detail.phone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No phone on file</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <VerificationBadge ok={detail.backgroundCheckVerified} label="Background check" />
                      <VerificationBadge ok={detail.insuranceVerified} label="Insured" />
                      {detail.isAvailable ? (
                        <Badge variant="positive" className="whitespace-nowrap">
                          <CheckCircle2 /> Available
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="whitespace-nowrap">
                          Unavailable
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Separator />

                  {/* Payout health + Connect */}
                  <section className="space-y-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      <CreditCard className="size-3.5" /> Payouts
                    </h3>
                    <div className="space-y-1 text-sm">
                      {canViewPayments ? (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Owed now</span>
                          <span className="font-semibold tnum text-foreground">{ph?.owedNowLabel ?? "$0"}</span>
                        </div>
                      ) : null}
                      {ph && ph.failedCount > 0 ? (
                        <div className="flex items-center justify-between text-destructive">
                          <span>Failed payouts</span>
                          <span className="font-semibold tnum">{ph.failedCount}</span>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Stripe Connect</span>
                        <span className="text-foreground">{CONNECT_LINE[detail.connect]}</span>
                      </div>
                    </div>
                    {detail.connect !== "ready" ? (
                      <div className="flex items-start gap-2 rounded-control border border-caution-700/30 bg-caution-50 px-3 py-2 text-xs text-caution-700">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          This cleaner has not finished Stripe payout setup, so payouts are paused. They
                          can finish it from their dashboard.
                        </span>
                      </div>
                    ) : null}
                  </section>

                  <Separator />

                  {/* Upcoming jobs */}
                  <section className="space-y-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      <CalendarDays className="size-3.5" /> Upcoming jobs
                    </h3>
                    {detailsLoading ? (
                      <ListSkeleton />
                    ) : upcoming.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No upcoming jobs.</p>
                    ) : (
                      upcoming.map((j) => (
                        <div
                          key={j.id}
                          className="flex items-start justify-between gap-3 rounded-control border border-border bg-card px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">{j.service}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {j.dateLabel}
                              {j.property ? ` · ${j.property}` : ""}
                            </div>
                          </div>
                          {j.priceLabel ? (
                            <span className="shrink-0 text-xs font-semibold tnum text-foreground">
                              {j.priceLabel}
                            </span>
                          ) : null}
                        </div>
                      ))
                    )}
                  </section>

                  {canEdit ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Button variant="secondary" className="w-full" onClick={() => onEditingChange(true)}>
                          <Pencil /> Edit cleaner
                        </Button>
                        <div className="grid grid-cols-2 gap-2">
                          {benched ? (
                            <Button variant="outline" onClick={onReactivate} loading={busy}>
                              <RotateCcw /> Reactivate
                            </Button>
                          ) : (
                            <Button variant="outline" onClick={onDeactivate} loading={busy}>
                              <Ban /> Deactivate
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            className="text-destructive hover:bg-critical-50 hover:text-destructive"
                            onClick={onRemove}
                            loading={busy}
                          >
                            <Trash2 /> Remove
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
