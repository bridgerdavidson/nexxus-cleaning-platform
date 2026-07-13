"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { keys } from "@/lib/queryKeys";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { countPropertyAppointments, archiveOrDeleteProperty } from "@/hooks/useAdminData";
import { planPropertyDeletion, type PropertyDeletePlan } from "@/lib/properties/deletePlan";

export type PropertyDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyName: string;
  organizationId: string;
  onDeleted?: () => void;
};

/**
 * Self-contained delete confirmation for a property (R4 audit gap, Task 9).
 * Re-fetches the live/history appointment counts on every open (counts can
 * change between opens) and picks one of three bodies via `planPropertyDeletion`:
 * never-booked -> hard delete, history-only -> archive in place, upcoming
 * cleanings -> a caution card explaining the cancel + archive, disabled for a
 * manager without `can_edit_bookings`. All the actual delete/cancel/archive
 * work happens server-side in `archiveOrDeleteProperty` (Task 4), which
 * re-derives the same plan; this dialog only chooses copy and invalidates
 * the queries the outcome touches.
 */
export function PropertyDeleteDialog({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  organizationId,
  onDeleted,
}: PropertyDeleteDialogProps) {
  const { permissions } = useManagerPermissions();
  const canEditBookings = !!permissions?.can_edit_bookings;
  const queryClient = useQueryClient();

  const [plan, setPlan] = useState<PropertyDeletePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch fresh counts every time the dialog opens (a cleaning could have
  // been booked/cancelled since the last time it was open). Reset on close
  // so a reopen never shows stale copy while the new fetch is in flight.
  useEffect(() => {
    if (!open) {
      setPlan(null);
      setError(null);
      return;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const counts = await countPropertyAppointments(propertyId);
        if (stale) return;
        setPlan(planPropertyDeletion(counts));
      } catch (e) {
        if (stale) return;
        setError(e instanceof Error ? e.message : "Could not check this property's cleanings.");
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, propertyId]);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await archiveOrDeleteProperty(propertyId, organizationId);
      if (!res.success) {
        toast.error(res.error ?? "Could not delete the property.");
        return;
      }
      toast.success(
        res.action === "cancel-and-archive"
          ? "Property deleted and its upcoming cleanings cancelled"
          : "Property deleted",
      );
      void queryClient.invalidateQueries({ queryKey: keys.properties.byOrg(organizationId) });
      void queryClient.invalidateQueries({ queryKey: keys.customers.byOrg(organizationId) });
      if (res.action === "cancel-and-archive") {
        void queryClient.invalidateQueries({ queryKey: keys.appointments.all });
      }
      onOpenChange(false);
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the property.");
    } finally {
      setDeleting(false);
    }
  }

  const blockedByPermission = plan?.action === "cancel-and-archive" && !canEditBookings;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!deleting) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {propertyName}?</DialogTitle>
          {plan?.action !== "cancel-and-archive" ? (
            <DialogDescription>
              {loading
                ? "Checking cleanings..."
                : plan?.action === "archive-only"
                  ? "Past cleanings stay on record. The property is archived so history still resolves."
                  : "No cleanings on record. This is permanent and can't be undone."}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {error ? (
          <div className="flex items-start gap-2 rounded-control border border-critical/30 bg-critical-50 px-3 py-2 text-sm text-critical-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {plan?.action === "cancel-and-archive" ? (
          <div className="flex items-start gap-2 rounded-control border border-caution/30 bg-caution-50 px-3 py-2 text-sm text-caution-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p>
                {`This property has ${plan.liveCount} upcoming cleaning${plan.liveCount === 1 ? "" : "s"} that will be cancelled. Past and cancelled cleanings stay on record. The property is archived.`}
              </p>
              {!canEditBookings ? (
                <p>
                  Removing the upcoming cleanings needs booking-edit permission. Ask an admin, or cancel
                  those cleanings first.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <DialogFooter className="mt-2 gap-2">
          <Button variant="ghost" disabled={deleting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={deleting}
            disabled={loading || deleting || !!error || blockedByPermission}
            onClick={() => void handleDelete()}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
