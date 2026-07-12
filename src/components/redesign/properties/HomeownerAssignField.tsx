"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Field } from "@/components/redesign/bookings/detail-atoms";
import {
  EntityPickerField,
  type PickerItem,
} from "@/components/redesign/bookings/new-booking/EntityPickerField";
import { personInitials } from "@/lib/initials";
import { useAuth } from "@/hooks/useAuth";
import { keys } from "@/lib/queryKeys";
import { updateProperty, useAdminCustomers, type AdminProperty } from "@/hooks/useAdminData";

type BusyAction = "select" | "remove" | null;

/**
 * Homeowner assign / change / remove block for the property edit form.
 * Writes are immediate (independent of the sheet's Save button): selecting a
 * homeowner or removing one persists via `updateProperty` right away, then
 * hands the fresh row back to the caller via `onUpdated`.
 */
export function HomeownerAssignField({
  propertyId,
  homeowner,
  onUpdated,
}: {
  propertyId: string;
  homeowner: AdminProperty["homeowner"];
  onUpdated: (updated: AdminProperty) => void;
}) {
  const { currentOrganizationId } = useAuth();
  const { customers, loading: customersLoading } = useAdminCustomers();
  const queryClient = useQueryClient();

  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const saving = busy !== null;

  const homeownerItems: PickerItem[] = customers.map((c) => ({
    id: c.id,
    label: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email,
    sublabel: c.email,
  }));

  async function writeOwner(ownerId: string | null, action: Exclude<BusyAction, null>, successMessage: string) {
    if (!currentOrganizationId) return;
    setBusy(action);
    const res = await updateProperty(propertyId, { owner_id: ownerId });
    setBusy(null);
    if (res.success && res.data) {
      onUpdated(res.data);
      void queryClient.invalidateQueries({ queryKey: keys.properties.byOrg(currentOrganizationId) });
      void queryClient.invalidateQueries({ queryKey: keys.customers.byOrg(currentOrganizationId) });
      setChanging(false);
      toast.success(successMessage);
    } else {
      toast.error(res.error ?? "Could not update the homeowner.");
    }
  }

  if (homeowner && !changing) {
    return (
      <Field label="Homeowner">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-9">
              <AvatarFallback className="text-xs">
                {personInitials(homeowner.first_name, homeowner.last_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">
                {`${homeowner.first_name} ${homeowner.last_name}`.trim()}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <Mail className="size-3.5 shrink-0" />
                {homeowner.email}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)} disabled={saving}>
              Change
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busy === "remove"}
              disabled={saving}
              onClick={() => void writeOwner(null, "remove", "Homeowner removed")}
            >
              Remove
            </Button>
          </div>
        </div>
      </Field>
    );
  }

  return (
    <div className="space-y-2">
      {!homeowner ? <Badge variant="secondary">Org-owned</Badge> : null}
      <EntityPickerField
        label={homeowner ? "Change homeowner" : "Assign homeowner"}
        placeholder="Select a homeowner"
        searchPlaceholder="Search homeowners..."
        value={homeowner?.id ?? null}
        items={homeownerItems}
        onSelect={(id) => void writeOwner(id, "select", "Homeowner updated")}
        loading={customersLoading}
        emptyText="No homeowners in this organization yet."
        disabled={saving}
      />
      {homeowner ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(false)} disabled={saving}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
