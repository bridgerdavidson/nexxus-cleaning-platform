"use client";

import { useState } from "react";
import { useDetailParam } from "@/hooks/useDetailParam";
import { useAdminProperties } from "@/hooks/useAdminData";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { PropertyDetailSheet } from "./PropertyDetailSheet";

/**
 * Shell-level `?property=<id>` host: opens the property detail sheet in place
 * on ANY operator page, mirroring OperatorBookingDetailHost's `?booking=`
 * host. Mounted once in OperatorShell behind can_view_properties + Suspense
 * (useDetailParam reads search params). Renders nothing when the id is
 * absent, or resolves to no row (e.g. a stale/foreign id, or a property that
 * has since been archived and dropped from useAdminProperties()). The
 * special id `"new"` opens the sheet in create mode instead of resolving a
 * row, and only when the operator has can_edit_properties; a pre-set owner
 * (`createOwnerId`) and a list/nav entry point that links here are later
 * tasks.
 */
export function OperatorPropertyDetailHost() {
  const { paramId, setParam } = useDetailParam("property");
  // Retain the last id after the param clears so the sheet stays mounted
  // through its exit animation instead of vanishing mid-close.
  const [lastId, setLastId] = useState<string | null>(null);
  if (paramId && paramId !== lastId) setLastId(paramId);
  if (!lastId) return null;
  return (
    <HostInner
      key={lastId}
      propertyId={lastId}
      open={!!paramId}
      onClose={() => setParam(null)}
    />
  );
}

function HostInner({
  propertyId,
  open,
  onClose,
}: {
  propertyId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { properties } = useAdminProperties();
  const { currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  const canEdit =
    currentOrgRole === "owner" ||
    currentOrgRole === "admin" ||
    !!permissions?.can_edit_properties;
  const isCreate = propertyId === "new";
  const property = isCreate ? null : (properties.find((p) => p.id === propertyId) ?? null);

  return (
    <PropertyDetailSheet
      open={open && (isCreate ? canEdit : !!property)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      property={property}
      mode={isCreate ? "create" : "read"}
    />
  );
}
