"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Building2, CalendarPlus, Mail, Pencil, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { Field, DiscardChangesDialog } from "@/components/redesign/bookings/detail-atoms";
import { PropertyPhotoField } from "@/components/redesign/properties/PropertyPhotoField";
import { HomeownerAssignField } from "@/components/redesign/properties/HomeownerAssignField";
import { PropertyDeleteDialog } from "@/components/redesign/properties/PropertyDeleteDialog";
import { personInitials } from "@/lib/initials";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { keys } from "@/lib/queryKeys";
import { stripeSelfPayUiEnabled } from "@/lib/stripe/flags";
import { updateProperty, type AdminProperty } from "@/hooks/useAdminData";
import { useOpenOperatorBooking } from "@/components/redesign/bookings/new-booking/useOpenOperatorBooking";
import { buildPropertySeed } from "@/components/redesign/bookings/new-booking/seedFromProperty";
import {
  EMPTY_PROPERTY_FORM,
  toNumberOrNull,
  validateProperty,
  type PropertyFormValues,
} from "@/lib/properties/validateProperty";

export type PropertyDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while the host's properties query hasn't resolved the row yet (or
   *  it doesn't exist); the host keeps `open` false in that case, so this
   *  never has to render a loading/error state of its own. Also null for the
   *  whole pre-first-save window of `mode="create"`. */
  property: AdminProperty | null;
  /** `"create"` starts the sheet directly in an empty editing form even
   *  though `property` is null. `"edit"` starts an existing row directly in
   *  the editing form (e.g. a list row's "Edit" menu action). Defaults to
   *  `"read"`. */
  mode?: "read" | "create" | "edit";
  /** Pre-set homeowner for a new property (e.g. opened from a customer's
   *  own detail sheet, a later task). `null` = org-owned. Only consulted in
   *  `mode="create"`. */
  createOwnerId?: string | null;
};

/** "123 Main St, Springfield, IL 62704" (omits any missing part). Mirrors the
 *  address-join pattern in OperatorCustomers' property view models. */
function fullAddress(p: AdminProperty): string {
  const cityLine = [p.city, [p.state, p.zip_code].filter(Boolean).join(" ").trim()]
    .filter(Boolean)
    .join(", ");
  return [p.address, cityLine].filter(Boolean).join(", ");
}

/** Property row -> form values. Mirrors PropertyFormSheet's `fromProperty`
 *  (homeowner account surface); field names are identical on `AdminProperty`. */
function fromProperty(p: AdminProperty): PropertyFormValues {
  return {
    name: p.name ?? "",
    address: p.address ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    zip_code: p.zip_code ?? "",
    bedrooms: p.bedrooms != null ? String(p.bedrooms) : "",
    bathrooms: p.bathrooms != null ? String(p.bathrooms) : "",
    square_feet: p.square_feet != null ? String(p.square_feet) : "",
    special_instructions: p.special_instructions ?? "",
    access_instructions: p.access_instructions ?? "",
  };
}

function formsEqual(a: PropertyFormValues, b: PropertyFormValues): boolean {
  return (Object.keys(a) as (keyof PropertyFormValues)[]).every((k) => a[k] === b[k]);
}

/**
 * Property detail sheet: read-only view (hero photo, name + address,
 * homeowner or an Org-owned badge, bed/bath/sqft, the two free-text
 * instruction fields) with Edit and Create modes layered on top. Edit state
 * is internal (not prop-drilled): a privileged role or `can_edit_properties`
 * reveals the Edit button, which flips the body into the same form used for
 * `mode="create"`. Delete opens `PropertyDeleteDialog` from the footer, gated
 * on the same `canEdit` as Edit. "Book cleaning" is the primary footer CTA,
 * gated on `can_edit_bookings` (mirrors OperatorShell's booking gate, not
 * `can_edit_properties`), and seeds the operator new-booking sheet via
 * `buildPropertySeed`.
 */
export function PropertyDetailSheet({
  open,
  onOpenChange,
  property,
  mode = "read",
  createOwnerId = null,
}: PropertyDetailSheetProps) {
  const { currentOrganizationId, currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  const queryClient = useQueryClient();
  const openBooking = useOpenOperatorBooking();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canEdit = privileged || !!permissions?.can_edit_properties;
  // Gated on booking permission (not property permission) - mirrors OperatorShell's
  // canCreateBooking gate, since the booking host itself is only mounted when this is true.
  const canBook = privileged || !!permissions?.can_edit_bookings;

  // The row this sheet is currently showing: the `property` prop for
  // read/edit, or (once a create-mode insert succeeds) the freshly returned
  // row held locally so the photo field can appear immediately without
  // waiting for the org properties query to refetch (see handleSave).
  const [activeProperty, setActiveProperty] = useState<AdminProperty | null>(property);
  const [editing, setEditing] = useState(mode === "create" || mode === "edit");
  // True only for the pre-first-save window of a create session; flips to
  // false the moment the insert succeeds, at which point Save/Cancel behave
  // like a normal edit session on the returned row.
  const [creating, setCreating] = useState(mode === "create");
  const [form, setForm] = useState<PropertyFormValues>(
    property ? fromProperty(property) : EMPTY_PROPERTY_FORM,
  );
  const [photoUrl, setPhotoUrl] = useState<string | null>(property?.photo_url ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Reset to a fresh state whenever the sheet opens: a blank create form for
  // `mode="create"`, or the loaded property (read view) otherwise. Keyed on
  // `property?.id` (not object identity) so a realtime-patched `property`
  // reference doesn't clobber an in-progress edit.
  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setActiveProperty(null);
      setForm(EMPTY_PROPERTY_FORM);
      setPhotoUrl(null);
      setEditing(true);
      setCreating(true);
      setError(null);
      return;
    }
    if (property) {
      setActiveProperty(property);
      setForm(fromProperty(property));
      setPhotoUrl(property.photo_url ?? null);
      setEditing(mode === "edit");
      setCreating(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, property?.id]);

  const setField = (key: keyof PropertyFormValues) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const dirty = creating
    ? !formsEqual(form, EMPTY_PROPERTY_FORM)
    : editing &&
      !!activeProperty &&
      (!formsEqual(form, fromProperty(activeProperty)) || photoUrl !== (activeProperty.photo_url ?? null));

  function requestClose(o: boolean) {
    if (saving) return;
    if (!o && dirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(o);
  }

  function cancelEdit() {
    // Create mode has no read view to fall back to: Cancel closes the sheet.
    if (creating) {
      onOpenChange(false);
      return;
    }
    if (activeProperty) {
      setForm(fromProperty(activeProperty));
      setPhotoUrl(activeProperty.photo_url ?? null);
    }
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    const validationError = validateProperty(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!currentOrganizationId) {
      setError("You are signed out. Please sign in again.");
      return;
    }
    setError(null);
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      zip_code: form.zip_code.trim(),
      bedrooms: toNumberOrNull(form.bedrooms),
      bathrooms: toNumberOrNull(form.bathrooms),
      square_feet: toNumberOrNull(form.square_feet),
      special_instructions: form.special_instructions.trim() || null,
      access_instructions: form.access_instructions.trim() || null,
    };

    try {
      if (creating) {
        const { data, error: insertError } = await supabase
          .from("properties")
          .insert({ ...payload, owner_id: createOwnerId ?? null, organization_id: currentOrganizationId })
          .select()
          .single();
        if (insertError) throw new Error(insertError.message);
        // Insert's `select()` returns only the row's own columns, no joined
        // homeowner - fine, `createOwnerId` defaults to null (org-owned) for
        // this task, and the background invalidation below will backfill the
        // join once the org properties list refetches.
        const inserted: AdminProperty = { ...(data as Omit<AdminProperty, "homeowner">), homeowner: null };
        setActiveProperty(inserted);
        setForm(fromProperty(inserted));
        setPhotoUrl(inserted.photo_url ?? null);
        setCreating(false);
        toast.success("Property created");
      } else if (activeProperty) {
        const res = await updateProperty(activeProperty.id, { ...payload, photo_url: photoUrl });
        if (!res.success) throw new Error(res.error ?? "Could not save the property.");
        const updated: AdminProperty = res.data ?? { ...activeProperty, ...payload, photo_url: photoUrl };
        setActiveProperty(updated);
        setForm(fromProperty(updated));
        setEditing(false);
        toast.success("Property updated");
      }
      void queryClient.invalidateQueries({ queryKey: keys.properties.byOrg(currentOrganizationId) });
      void queryClient.invalidateQueries({ queryKey: keys.customers.byOrg(currentOrganizationId) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save the property.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const showBody = mode === "create" || !!activeProperty;

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          {showBody ? (
            <>
              <SheetHeader className="pr-12">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="" className="h-40 w-full rounded-card object-cover" />
                ) : (
                  <div className="grid h-40 w-full place-items-center rounded-card bg-brand-50 text-brand-600">
                    <Building2 className="size-10" aria-hidden />
                  </div>
                )}
                <SheetTitle className="mt-2 truncate">
                  {activeProperty ? activeProperty.name : "New property"}
                </SheetTitle>
                <SheetDescription>
                  {activeProperty ? fullAddress(activeProperty) : "Add a property to this organization."}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
                {editing ? (
                  <div className="space-y-4">
                    {activeProperty ? (
                      <PropertyPhotoField
                        propertyId={activeProperty.id}
                        currentPhotoUrl={photoUrl}
                        onUploaded={setPhotoUrl}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Save this property first to add a photo.
                      </p>
                    )}

                    {stripeSelfPayUiEnabled() && !creating && activeProperty ? (
                      <>
                        <HomeownerAssignField
                          propertyId={activeProperty.id}
                          homeowner={activeProperty.homeowner}
                          onUpdated={(u) => setActiveProperty(u)}
                        />
                        <Separator />
                      </>
                    ) : null}

                    <FormField label="Property name" htmlFor="prop-name" required>
                      <Input
                        id="prop-name"
                        value={form.name}
                        onChange={(e) => setField("name")(e.target.value)}
                        placeholder="Main house"
                      />
                    </FormField>
                    <FormField label="Street address" htmlFor="prop-address" required>
                      <Input
                        id="prop-address"
                        value={form.address}
                        onChange={(e) => setField("address")(e.target.value)}
                        autoComplete="address-line1"
                      />
                    </FormField>
                    <div className="grid grid-cols-3 gap-3">
                      <FormField label="City" htmlFor="prop-city" required>
                        <Input
                          id="prop-city"
                          value={form.city}
                          onChange={(e) => setField("city")(e.target.value)}
                          autoComplete="address-level2"
                        />
                      </FormField>
                      <FormField label="State" htmlFor="prop-state" required>
                        <Input
                          id="prop-state"
                          value={form.state}
                          onChange={(e) => setField("state")(e.target.value)}
                          autoComplete="address-level1"
                        />
                      </FormField>
                      <FormField label="ZIP" htmlFor="prop-zip" required>
                        <Input
                          id="prop-zip"
                          value={form.zip_code}
                          onChange={(e) => setField("zip_code")(e.target.value)}
                          inputMode="numeric"
                          autoComplete="postal-code"
                        />
                      </FormField>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <FormField label="Bedrooms" htmlFor="prop-beds">
                        <Input
                          id="prop-beds"
                          value={form.bedrooms}
                          onChange={(e) => setField("bedrooms")(e.target.value)}
                          inputMode="numeric"
                        />
                      </FormField>
                      <FormField label="Bathrooms" htmlFor="prop-baths">
                        <Input
                          id="prop-baths"
                          value={form.bathrooms}
                          onChange={(e) => setField("bathrooms")(e.target.value)}
                          inputMode="numeric"
                        />
                      </FormField>
                      <FormField label="Square feet" htmlFor="prop-sqft">
                        <Input
                          id="prop-sqft"
                          value={form.square_feet}
                          onChange={(e) => setField("square_feet")(e.target.value)}
                          inputMode="numeric"
                        />
                      </FormField>
                    </div>
                    <FormField label="Special instructions" htmlFor="prop-special">
                      <Textarea
                        id="prop-special"
                        value={form.special_instructions}
                        onChange={(e) => setField("special_instructions")(e.target.value)}
                        rows={3}
                        placeholder="Anything our cleaners should know"
                      />
                    </FormField>
                    <FormField label="Access instructions" htmlFor="prop-access">
                      <Textarea
                        id="prop-access"
                        value={form.access_instructions}
                        onChange={(e) => setField("access_instructions")(e.target.value)}
                        rows={3}
                        placeholder="Gate code, key location, parking"
                      />
                    </FormField>

                    {error ? (
                      <div className="flex items-start gap-2 rounded-control border border-critical/30 bg-critical-50 px-3 py-2 text-sm text-critical-700">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>{error}</span>
                      </div>
                    ) : null}

                    <Separator />

                    <div className="grid grid-cols-2 gap-2">
                      <Button onClick={() => void handleSave()} loading={saving} disabled={!creating && !dirty}>
                        {creating ? "Create" : "Save"}
                      </Button>
                      <Button variant="secondary" onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  activeProperty && (
                    <>
                      <Field label="Homeowner">
                        {activeProperty.homeowner ? (
                          <div className="flex items-center gap-3">
                            <Avatar className="size-9">
                              <AvatarFallback className="text-xs">
                                {personInitials(activeProperty.homeowner.first_name, activeProperty.homeowner.last_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {`${activeProperty.homeowner.first_name ?? ""} ${activeProperty.homeowner.last_name ?? ""}`.trim() || activeProperty.homeowner.email}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                                <Mail className="size-3.5 shrink-0" />
                                {activeProperty.homeowner.email}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <Badge variant="secondary">Org-owned</Badge>
                        )}
                      </Field>

                      <Separator />

                      <div className="grid grid-cols-3 gap-3">
                        <Field label="Bedrooms">{activeProperty.bedrooms ?? "Not set"}</Field>
                        <Field label="Bathrooms">{activeProperty.bathrooms ?? "Not set"}</Field>
                        <Field label="Square feet">
                          {activeProperty.square_feet != null
                            ? activeProperty.square_feet.toLocaleString("en-US")
                            : "Not set"}
                        </Field>
                      </div>

                      <Separator />

                      <Field label="Special instructions">
                        {activeProperty.special_instructions || "None on file."}
                      </Field>

                      <Separator />

                      <Field label="Access instructions">
                        {activeProperty.access_instructions || "None on file."}
                      </Field>

                      {canBook || canEdit ? (
                        <>
                          <Separator />
                          <div className="space-y-2">
                            {canBook ? (
                              <Button
                                className="w-full"
                                onClick={() => openBooking(buildPropertySeed(activeProperty))}
                              >
                                <CalendarPlus /> Book cleaning
                              </Button>
                            ) : null}
                            {canEdit ? (
                              <div className="grid grid-cols-2 gap-2">
                                <Button variant="secondary" onClick={() => setEditing(true)}>
                                  <Pencil /> Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  className="text-critical-700 hover:bg-critical-50 hover:text-critical-700"
                                  onClick={() => setDeleteOpen(true)}
                                >
                                  <Trash2 /> Delete
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </>
                  )
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <DiscardChangesDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        description="This property has unsaved changes."
        onConfirm={() => {
          setConfirmClose(false);
          onOpenChange(false);
        }}
      />

      {activeProperty ? (
        <PropertyDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          propertyId={activeProperty.id}
          propertyName={activeProperty.name}
          organizationId={currentOrganizationId ?? ""}
          onDeleted={() => onOpenChange(false)}
        />
      ) : null}
    </>
  );
}
