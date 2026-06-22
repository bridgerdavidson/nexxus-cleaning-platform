"use client";

import { useEffect, useState } from "react";
import { Mail, Phone, Home, CalendarDays, Pencil, Trash2, Building2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { HistoryStatusBadge } from "./customers-presenters";
import type { CustomerDetailVM, CustomerHistoryVM, CustomerPropertyVM } from "./customers-types";

export type CustomerSaveFields = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

export type CustomerDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: CustomerDetailVM | null;
  properties: CustomerPropertyVM[];
  history: CustomerHistoryVM[];
  detailsLoading: boolean;
  canViewPayments: boolean;
  canEdit: boolean;
  busy?: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Returns true on success so the sheet can exit edit mode. */
  onSave: (fields: CustomerSaveFields) => Promise<boolean>;
  onDelete: () => void;
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
        <Skeleton key={i} className="h-16 w-full rounded-control" />
      ))}
    </div>
  );
}

export function CustomerDetailSheet({
  open,
  onOpenChange,
  detail,
  properties,
  history,
  detailsLoading,
  canViewPayments,
  canEdit,
  busy,
  editing,
  onEditingChange,
  onSave,
  onDelete,
}: CustomerDetailSheetProps) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });

  // Reset the edit form whenever a different customer opens or edit mode begins.
  useEffect(() => {
    if (detail) {
      setForm({
        firstName: detail.firstName,
        lastName: detail.lastName,
        email: detail.email,
        phone: detail.phone ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, editing]);

  const statCols = canViewPayments ? "grid-cols-3" : "grid-cols-2";

  const save = async () => {
    const ok = await onSave({
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
    });
    if (ok) onEditingChange(false);
  };

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
                  <SheetDescription>Customer since {detail.sinceLabel}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
              {editing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="First name" htmlFor="cust-first">
                      <Input
                        id="cust-first"
                        value={form.firstName}
                        onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Last name" htmlFor="cust-last">
                      <Input
                        id="cust-last"
                        value={form.lastName}
                        onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                      />
                    </FormField>
                  </div>
                  <FormField label="Email" htmlFor="cust-email">
                    <Input
                      id="cust-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                  </FormField>
                  <FormField label="Phone" htmlFor="cust-phone" helper="Optional">
                    <Input
                      id="cust-phone"
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
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
                  <div className={`grid gap-3 ${statCols}`}>
                    <StatBox label="Properties" value={String(detail.propertiesCount)} />
                    <StatBox label="Bookings" value={String(detail.appointmentsCount)} />
                    {canViewPayments ? (
                      <StatBox label="Total spent" value={detail.totalSpentLabel ?? "$0"} />
                    ) : null}
                  </div>

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
                  </div>

                  <Separator />

                  <section className="space-y-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      <Home className="size-3.5" /> Properties
                    </h3>
                    {detailsLoading ? (
                      <ListSkeleton />
                    ) : properties.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No properties on file.</p>
                    ) : (
                      properties.map((p) => (
                        <div key={p.id} className="rounded-control border border-border bg-card px-3 py-2">
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{p.name}</span>
                          </div>
                          <div className="mt-0.5 text-sm text-muted-foreground">{p.address}</div>
                          {p.metaLabel ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">{p.metaLabel}</div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </section>

                  <Separator />

                  <section className="space-y-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      <CalendarDays className="size-3.5" /> Booking history
                    </h3>
                    {detailsLoading ? (
                      <ListSkeleton />
                    ) : history.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No bookings yet.</p>
                    ) : (
                      history.map((h) => (
                        <div
                          key={h.id}
                          className="flex items-start justify-between gap-3 rounded-control border border-border bg-card px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">{h.service}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {h.dateLabel}
                              {h.property ? ` · ${h.property}` : ""}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <HistoryStatusBadge status={h.status} />
                            {h.priceLabel ? (
                              <span className="text-xs font-semibold tnum text-foreground">{h.priceLabel}</span>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </section>

                  {canEdit ? (
                    <>
                      <Separator />
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => onEditingChange(true)}>
                          <Pencil /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          className="text-destructive hover:bg-critical-50 hover:text-destructive"
                          onClick={onDelete}
                          loading={busy}
                        >
                          <Trash2 /> Delete
                        </Button>
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
