"use client";

import { useEffect, useState } from "react";
import { Mail, Trash2, ShieldCheck, Save } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ManagerPermissions } from "@/hooks/useAdminData";
import { RoleBadge } from "./staff-presenters";
import type { StaffDetailVM } from "./staff-types";

// The 15 manager-permission flags, grouped + labeled. Mirrors the legacy
// settings/team permission editor so the meaning stays identical; rendered here
// with the redesign primitives inside the Staff Sheet.
const PERMISSION_GROUPS: {
  title: string;
  permissions: { key: keyof ManagerPermissions; label: string; description: string }[];
}[] = [
  {
    title: "Customers",
    permissions: [
      { key: "can_view_customers", label: "View customers", description: "See customer profiles and information" },
      { key: "can_edit_customers", label: "Edit customers", description: "Edit customer information and profiles" },
    ],
  },
  {
    title: "Bookings",
    permissions: [
      { key: "can_view_bookings", label: "View bookings", description: "See all appointments and bookings" },
      { key: "can_edit_bookings", label: "Edit bookings", description: "Create, update, and manage appointments" },
      { key: "can_approve_decline_bookings", label: "Approve or decline", description: "Approve or decline pending requests" },
      { key: "can_handle_requests", label: "Handle requests", description: "Assign cleaners and force-assign on escalation" },
    ],
  },
  {
    title: "Cleaners",
    permissions: [
      { key: "can_manage_cleaners", label: "Manage cleaners", description: "View and manage cleaner profiles" },
    ],
  },
  {
    title: "Properties",
    permissions: [
      { key: "can_view_properties", label: "View properties", description: "See property information" },
      { key: "can_edit_properties", label: "Edit properties", description: "Edit property details" },
    ],
  },
  {
    title: "Payments",
    permissions: [
      { key: "can_view_payments", label: "View payments", description: "See payment information and history" },
      { key: "can_manage_payments", label: "Manage payments", description: "Process and manage payments" },
    ],
  },
  {
    title: "Services",
    permissions: [
      { key: "can_view_services", label: "View services", description: "See service types and offerings" },
      { key: "can_manage_services", label: "Manage services", description: "Create, edit, and delete services" },
    ],
  },
  {
    title: "Other",
    permissions: [
      { key: "can_view_analytics", label: "View analytics", description: "Access analytics and reporting" },
      { key: "can_view_messages", label: "View messages", description: "Access the messaging system" },
    ],
  },
];

const ALL_KEYS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

export type StaffDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: StaffDetailVM | null;
  canManage: boolean;
  busy?: boolean;
  /** Returns true on success. */
  onSavePermissions: (permissions: ManagerPermissions) => Promise<boolean>;
  onRemove: () => void;
};

export function StaffDetailSheet({
  open,
  onOpenChange,
  detail,
  canManage,
  busy,
  onSavePermissions,
  onRemove,
}: StaffDetailSheetProps) {
  const [perms, setPerms] = useState<ManagerPermissions | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setPerms(detail?.permissions ?? null);
    setDirty(false);
  }, [detail?.id, detail?.permissions]);

  const isManager = detail?.role === "manager";
  const enabledCount = perms ? ALL_KEYS.filter((k) => perms[k]).length : 0;

  const toggle = (key: keyof ManagerPermissions) => {
    setPerms((prev) => (prev ? { ...prev, [key]: !prev[key] } : prev));
    setDirty(true);
  };

  const save = async () => {
    if (!perms) return;
    const ok = await onSavePermissions(perms);
    if (ok) setDirty(false);
  };

  const canRemove = canManage && detail && !detail.isOwner && !detail.isSelf;

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
                  <SheetTitle className="truncate">
                    {detail.name}
                    {detail.isSelf ? <span className="ml-1 text-sm font-normal text-muted-foreground">(you)</span> : null}
                  </SheetTitle>
                  <SheetDescription>Member since {detail.sinceLabel}</SheetDescription>
                  <div className="mt-1">
                    <RoleBadge role={detail.role} />
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                <a href={`mailto:${detail.email}`} className="truncate text-foreground hover:underline">
                  {detail.email}
                </a>
              </div>

              <Separator />

              {isManager && perms ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                      <ShieldCheck className="size-3.5" /> Permissions
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {enabledCount} of {ALL_KEYS.length}
                    </span>
                  </div>

                  {PERMISSION_GROUPS.map((group) => (
                    <div key={group.title} className="space-y-2">
                      <h4 className="text-xs font-semibold text-foreground">{group.title}</h4>
                      {group.permissions.map((p) => (
                        <label
                          key={p.key}
                          className="flex cursor-pointer items-start justify-between gap-3 rounded-control px-1 py-1.5"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-foreground">{p.label}</span>
                            <span className="block text-xs text-muted-foreground">{p.description}</span>
                          </span>
                          <Switch
                            checked={!!perms[p.key]}
                            onCheckedChange={() => toggle(p.key)}
                            disabled={!canManage || busy}
                            aria-label={p.label}
                          />
                        </label>
                      ))}
                    </div>
                  ))}

                  {canManage ? (
                    <Button onClick={() => void save()} loading={busy} disabled={!dirty} className="w-full">
                      <Save /> Save permissions
                    </Button>
                  ) : null}
                </section>
              ) : (
                <div className="rounded-control border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  {detail.role === "owner"
                    ? "The owner has full access to everything and cannot be restricted."
                    : "Admins have full access to everything. Only managers have adjustable permissions."}
                </div>
              )}

              {canRemove ? (
                <>
                  <Separator />
                  <Button
                    variant="outline"
                    className="w-full text-destructive hover:bg-critical-50 hover:text-destructive"
                    onClick={onRemove}
                    loading={busy}
                  >
                    <Trash2 /> Remove from team
                  </Button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export { PERMISSION_GROUPS, ALL_KEYS as PERMISSION_KEYS };
