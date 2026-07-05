"use client";

import { useEffect, useMemo, useState } from "react";
import { DollarSign } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { getAccessToken } from "@/lib/auth/clientAccessToken";

type Homeowner = { id: string; first_name: string; last_name: string; email: string };
type Appt = {
  id: string;
  scheduled_date: string;
  property: { name?: string; address?: string } | null;
  service_type: { name?: string } | null;
};
type Method = "card" | "ach" | "manual";

export type RecordPaymentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
};

/**
 * Records a manual payment against a booking (POST /api/payments/record). The route
 * requires an appointment_id, so the flow is: find the customer, pick one of their
 * bookings, then enter amount + method. Restyled from the legacy RecordPaymentModal.
 */
export function RecordPaymentDialog({ open, onOpenChange, onRecorded }: RecordPaymentDialogProps) {
  const { currentOrganizationId } = useAuth();
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [homeownerSearch, setHomeownerSearch] = useState("");
  const [homeownerId, setHomeownerId] = useState<string | null>(null);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [apptsLoading, setApptsLoading] = useState(false);
  const [apptId, setApptId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("manual");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setHomeownerSearch("");
    setHomeownerId(null);
    setAppts([]);
    setApptId("");
    setAmount("");
    setMethod("manual");
    setReference("");
    setNotes("");
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data } = await supabase
        .from("user_profiles")
        .select("id, first_name, last_name, email")
        .eq("role", "homeowner")
        .order("first_name");
      setHomeowners((data as Homeowner[]) ?? []);
    })();
  }, [open]);

  useEffect(() => {
    if (!homeownerId || !currentOrganizationId) {
      setAppts([]);
      return;
    }
    setApptsLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("appointments")
        .select("id, scheduled_date, property:properties(name, address), service_type:service_types(name)")
        .eq("organization_id", currentOrganizationId)
        .eq("homeowner_id", homeownerId)
        .order("scheduled_date", { ascending: false });
      const rows = ((data as Record<string, unknown>[]) ?? []).map((a) => ({
        id: a.id as string,
        scheduled_date: a.scheduled_date as string,
        property: (Array.isArray(a.property) ? a.property[0] : a.property) as Appt["property"],
        service_type: (Array.isArray(a.service_type)
          ? a.service_type[0]
          : a.service_type) as Appt["service_type"],
      }));
      setAppts(rows);
      setApptsLoading(false);
    })();
  }, [homeownerId, currentOrganizationId]);

  const filtered = useMemo(() => {
    const q = homeownerSearch.trim().toLowerCase();
    if (!q) return [];
    return homeowners
      .filter((h) => `${h.first_name} ${h.last_name} ${h.email}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [homeowners, homeownerSearch]);

  const selectedHomeowner = homeowners.find((h) => h.id === homeownerId) ?? null;

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const apptLabel = (a: Appt) =>
    `${a.scheduled_date} · ${a.property?.name || a.property?.address || "Property"} · ${a.service_type?.name || "Service"}`;

  const submit = async () => {
    setError(null);
    if (!apptId) {
      setError("Select a booking to attach the payment to.");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/payments/record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          organization_id: currentOrganizationId,
          appointment_id: apptId,
          amount: Number(amount),
          payment_method: method,
          payment_type: "revenue",
          notes: notes || null,
          reference: reference || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to record payment");
      toast.success("Payment recorded");
      onRecorded();
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Log a manual payment (cash, check, or external) against a booking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <p className="rounded-control bg-critical-50 px-3 py-2 text-sm text-critical-700">{error}</p>
          ) : null}

          {selectedHomeowner ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Customer</span>
              <div className="flex items-center justify-between gap-3 rounded-field border border-border bg-muted/30 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">
                    {selectedHomeowner.first_name} {selectedHomeowner.last_name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{selectedHomeowner.email}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHomeownerId(null);
                    setApptId("");
                  }}
                >
                  Change
                </Button>
              </div>
            </div>
          ) : (
            <FormField label="Customer" htmlFor="rp-customer" required helper="Search by name or email.">
              <Input
                id="rp-customer"
                value={homeownerSearch}
                onChange={(e) => setHomeownerSearch(e.target.value)}
                placeholder="Search customers"
                autoComplete="off"
              />
            </FormField>
          )}

          {!selectedHomeowner && filtered.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded-field border border-border">
              {filtered.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    setHomeownerId(h.id);
                    setHomeownerSearch("");
                    setApptId("");
                  }}
                  className="flex w-full flex-col border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted/50"
                >
                  <span className="font-medium text-foreground">
                    {h.first_name} {h.last_name}
                  </span>
                  <span className="text-xs text-muted-foreground">{h.email}</span>
                </button>
              ))}
            </div>
          ) : null}

          {selectedHomeowner ? (
            <FormField label="Booking" htmlFor="rp-appt" required>
              {apptsLoading ? (
                <Input id="rp-appt" value="" placeholder="Loading bookings..." disabled />
              ) : appts.length === 0 ? (
                <Input id="rp-appt" value="" placeholder="This customer has no bookings" disabled />
              ) : (
                <Select value={apptId} onValueChange={setApptId}>
                  <SelectTrigger id="rp-appt">
                    <SelectValue placeholder="Select a booking" />
                  </SelectTrigger>
                  <SelectContent>
                    {appts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {apptLabel(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Amount" htmlFor="rp-amount" required>
              <Input
                id="rp-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </FormField>
            <FormField label="Method" htmlFor="rp-method" required>
              <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
                <SelectTrigger id="rp-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="ach">ACH</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <FormField label="Reference" htmlFor="rp-ref" helper="Optional">
            <Input
              id="rp-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Transaction reference or ID"
            />
          </FormField>
          <FormField label="Notes" htmlFor="rp-notes" helper="Optional">
            <Textarea
              id="rp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add any additional notes"
            />
          </FormField>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!apptId}>
            <DollarSign /> Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
