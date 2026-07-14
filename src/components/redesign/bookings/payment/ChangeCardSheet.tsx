"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, Landmark, Loader2, MailPlus } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { getAccessToken } from "@/lib/auth/clientAccessToken";
import { keys } from "@/lib/queryKeys";
import {
  paymentMethodSubtitle,
  paymentMethodTitle,
} from "@/components/redesign/shared/payment-methods/derive-payment-methods";
import { useAppointmentCard } from "./useAppointmentCard";

export interface ChangeCardSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  homeownerId: string | null;
  organizationId: string | null;
  currentPaymentMethodId: string | null;
  onChanged: () => void;
  /**
   * When the customer has <=1 saved card there's nothing to swap to, so the sheet degrades to a
   * hint. If provided, the hint offers a one-click Email card link (fires this, then closes) instead
   * of a dead-end "Got it".
   */
  onEmailCardLink?: () => void;
}

/**
 * Operator card picker for a single appointment: lists the homeowner's saved
 * cards (the same source that resolves "card on file" in OperatorPaymentSection),
 * marks the currently-attached one, and lets the operator swap in another
 * already-saved card. Operators cannot add a new card on the homeowner's
 * behalf, so with one or zero cards this degrades to a hint pointing at
 * Email card link instead.
 */
export function ChangeCardSheet({
  open,
  onOpenChange,
  appointmentId,
  homeownerId,
  organizationId,
  currentPaymentMethodId,
  onChanged,
  onEmailCardLink,
}: ChangeCardSheetProps) {
  const queryClient = useQueryClient();
  const [settingId, setSettingId] = useState<string | null>(null);

  const { cards, loading } = useAppointmentCard({
    appointmentId,
    homeownerId,
    organizationId,
    paymentMethodId: currentPaymentMethodId,
    enabled: open,
  });

  const handleSelect = async (paymentMethodId: string) => {
    if (!organizationId || paymentMethodId === currentPaymentMethodId || settingId) return;
    setSettingId(paymentMethodId);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/payment-method`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ organization_id: organizationId, payment_method_id: paymentMethodId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change the card");
      void queryClient.invalidateQueries({ queryKey: keys.appointments.all });
      toast.success("Card updated");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the card");
    } finally {
      setSettingId(null);
    }
  };

  const showHint = !loading && cards.length <= 1;

  return (
    <Drawer open={open} onOpenChange={(v) => !settingId && onOpenChange(v)}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Change card</DrawerTitle>
          <DrawerDescription>Choose a saved card for this booking.</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[72vh] space-y-2 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {loading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-card" />)
          ) : showHint ? (
            <div className="space-y-3 rounded-card border border-dashed border-border p-4 text-center">
              <MailPlus className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                This customer has no other saved card. Use Email card link so they can add a new one.
              </p>
              {onEmailCardLink ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    onEmailCardLink();
                    onOpenChange(false);
                  }}
                >
                  Email card link
                </Button>
              ) : (
                <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
                  Got it
                </Button>
              )}
            </div>
          ) : (
            cards.map((pm) => {
              const isCurrent = pm.id === currentPaymentMethodId;
              const Icon = pm.type === "us_bank_account" ? Landmark : CreditCard;
              const busy = settingId === pm.id;
              return (
                <button
                  key={pm.id}
                  type="button"
                  disabled={!!settingId || isCurrent}
                  onClick={() => handleSelect(pm.id)}
                  className={
                    "flex w-full items-center gap-3 rounded-card border p-4 text-left transition-colors disabled:cursor-default " +
                    (isCurrent ? "border-brand-600 bg-brand-50" : "border-border bg-card hover:bg-muted disabled:opacity-50")
                  }
                >
                  <div className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-foreground">{paymentMethodTitle(pm)}</span>
                      {isCurrent ? (
                        <span className="shrink-0 rounded-pill bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                          Current
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{paymentMethodSubtitle(pm)}</div>
                  </div>
                  {busy ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                  ) : isCurrent ? (
                    <Check className="size-5 shrink-0 text-brand-600" aria-hidden />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
