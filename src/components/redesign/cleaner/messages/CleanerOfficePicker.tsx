"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import type { OfficeContact } from "./office-contacts";

const ROLE_HINT: Record<string, string> = { admin: "Admin", manager: "Manager" };

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "O"
  );
}

/** "New message" compose picker: lists the office (admins/managers) so the cleaner
 *  can start a thread with a SPECIFIC person. Phone-first bottom sheet. */
export function CleanerOfficePicker({
  open,
  onOpenChange,
  contacts,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contacts: OfficeContact[];
  onPick: (contact: OfficeContact) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Message your office</DrawerTitle>
        </DrawerHeader>
        <div className="max-h-[60dvh] overflow-y-auto px-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {contacts.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No office contacts yet.</p>
          ) : (
            contacts.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c)}
                className="flex w-full items-center gap-3 rounded-control px-3 py-3 text-left transition-colors active:bg-accent hover:bg-accent/60"
              >
                <Avatar className="size-10 shrink-0">
                  {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt="" /> : null}
                  <AvatarFallback>{initials(c.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.orgRole === "owner" ? "Owner" : ROLE_HINT[c.role] ?? "Office"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
