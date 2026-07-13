"use client";

import { useState } from "react";
import { useDetailParam } from "@/hooks/useDetailParam";
import { useAdminProperties } from "@/hooks/useAdminData";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { PropertyDetailSheet } from "./PropertyDetailSheet";
import { useOpenProperty } from "./useOpenProperty";

/**
 * Shell-level `?property=<id>` host: opens the property detail sheet in place
 * on ANY operator page, mirroring OperatorBookingDetailHost's `?booking=`
 * host. Mounted once in OperatorShell behind can_view_properties + Suspense
 * (useDetailParam reads search params). Renders nothing when the id is
 * absent, or resolves to no row (e.g. a stale/foreign id, or a property that
 * has since been archived and dropped from useAdminProperties()). The
 * special id `"new"` opens the sheet in create mode instead of resolving a
 * row, and only when the operator has can_edit_properties. A companion
 * `?propertyEdit=1` param (set by a list row's "Edit" menu action via
 * useOpenProperty().openForEdit) opens an existing row directly in edit mode
 * instead of read mode; a pre-set owner (`createOwnerId`) is a later task.
 */
export function OperatorPropertyDetailHost() {
  const { paramId } = useDetailParam("property");
  const { paramId: editFlag } = useDetailParam("propertyEdit");
  const { close } = useOpenProperty();
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
      editFlag={editFlag}
      onClose={close}
    />
  );
}

function HostInner({
  propertyId,
  open,
  editFlag,
  onClose,
}: {
  propertyId: string;
  open: boolean;
  editFlag: string | null;
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
  const wantsEdit = editFlag === "1";
  const property = isCreate ? null : (properties.find((p) => p.id === propertyId) ?? null);

  return (
    <PropertyDetailSheet
      open={open && (isCreate ? canEdit : !!property)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      property={property}
      mode={isCreate ? "create" : wantsEdit && canEdit ? "edit" : "read"}
    />
  );
}
