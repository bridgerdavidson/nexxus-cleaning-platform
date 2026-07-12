"use client";

import { Building2, Mail } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Field } from "@/components/redesign/bookings/detail-atoms";
import { personInitials } from "@/lib/initials";
import type { AdminProperty } from "@/hooks/useAdminData";

export type PropertyDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while the host's properties query hasn't resolved the row yet (or
   *  it doesn't exist); the host keeps `open` false in that case, so this
   *  never has to render a loading/error state of its own. */
  property: AdminProperty | null;
};

/** "123 Main St, Springfield, IL 62704" (omits any missing part). Mirrors the
 *  address-join pattern in OperatorCustomers' property view models. */
function fullAddress(p: AdminProperty): string {
  const cityLine = [p.city, [p.state, p.zip_code].filter(Boolean).join(" ").trim()]
    .filter(Boolean)
    .join(", ");
  return [p.address, cityLine].filter(Boolean).join(", ");
}

/**
 * Read-only property detail sheet: hero photo, name + address, homeowner (or
 * an Org-owned badge), bed/bath/sqft, and the two free-text instruction
 * fields. Edit / Book / Delete actions are added by later tasks; this task
 * ships view-only with just the standard sheet close affordance.
 */
export function PropertyDetailSheet({ open, onOpenChange, property }: PropertyDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {property ? (
          <>
            <SheetHeader className="pr-12">
              {property.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={property.photo_url}
                  alt=""
                  className="h-40 w-full rounded-card object-cover"
                />
              ) : (
                <div className="grid h-40 w-full place-items-center rounded-card bg-brand-50 text-brand-600">
                  <Building2 className="size-10" aria-hidden />
                </div>
              )}
              <SheetTitle className="mt-2 truncate">{property.name}</SheetTitle>
              <SheetDescription>{fullAddress(property)}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
              <Field label="Homeowner">
                {property.homeowner ? (
                  <div className="flex items-center gap-3">
                    <Avatar className="size-9">
                      <AvatarFallback className="text-xs">
                        {personInitials(property.homeowner.first_name, property.homeowner.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {`${property.homeowner.first_name} ${property.homeowner.last_name}`.trim()}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <Mail className="size-3.5 shrink-0" />
                        {property.homeowner.email}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Badge variant="secondary">Org-owned</Badge>
                )}
              </Field>

              <Separator />

              <div className="grid grid-cols-3 gap-3">
                <Field label="Bedrooms">{property.bedrooms ?? "Not set"}</Field>
                <Field label="Bathrooms">{property.bathrooms ?? "Not set"}</Field>
                <Field label="Square feet">
                  {property.square_feet != null ? property.square_feet.toLocaleString("en-US") : "Not set"}
                </Field>
              </div>

              <Separator />

              <Field label="Special instructions">
                {property.special_instructions || "None on file."}
              </Field>

              <Separator />

              <Field label="Access instructions">
                {property.access_instructions || "None on file."}
              </Field>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
