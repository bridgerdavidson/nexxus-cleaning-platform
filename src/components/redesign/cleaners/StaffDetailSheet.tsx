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
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ManagerPermissions } from "@/hooks/useAdminData";
import { MANAGER_FLAG_KEYS } from "@/lib/permissions/managerFlags";
import { ManagerPermissionEditor } from "@/components/settings/ManagerPermissionEditor";
import { RoleBadge } from "./staff-presenters";
import type { StaffDetailVM } from "./staff-types";

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
  const enabledCount = perms ? MANAGER_FLAG_KEYS.filter((k) => perms[k]).length : 0;

  const handlePermissionsChange = (next: ManagerPermissions) => {
    setPerms(next);
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
                      {enabledCount} of {MANAGER_FLAG_KEYS.length}
                    </span>
                  </div>

                  <ManagerPermissionEditor
                    value={perms}
                    onChange={handlePermissionsChange}
                    disabled={!canManage || busy}
                  />

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

export { MANAGER_FLAG_KEYS as PERMISSION_KEYS } from '@/lib/permissions/managerFlags';
