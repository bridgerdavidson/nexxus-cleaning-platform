"use client";

import { Loader2, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PersonPicker, PersonPickerRow } from "@/components/redesign/messages/PersonPicker";
import { initialsFromFullName } from "@/components/redesign/messages/messages-format";
import { ROLE_LABEL } from "@/components/redesign/messages/messages-pills";
import type { OfficeContact } from "./office-contacts";

/** "New message" compose picker: lists the office (admins/managers) so the cleaner
 *  can start a thread with a SPECIFIC person. */
export function CleanerOfficePicker({
  open,
  onOpenChange,
  contacts,
  onPick,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contacts: OfficeContact[];
  onPick: (contact: OfficeContact) => void;
  /** While the office contacts are still loading, show a spinner instead of the empty state. */
  loading?: boolean;
}) {
  return (
    <PersonPicker open={open} onOpenChange={onOpenChange} title="Message your office">
      {loading && contacts.length === 0 ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading office contacts" />
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState compact icon={<Users />} title="No office contacts yet" />
      ) : (
        contacts.map((c) => (
          <PersonPickerRow
            key={c.id}
            avatarUrl={c.avatarUrl}
            initials={initialsFromFullName(c.name)}
            title={c.name}
            subtitle={c.orgRole === "owner" ? "Owner" : ROLE_LABEL[c.role] ?? "Office"}
            onSelect={() => onPick(c)}
          />
        ))
      )}
    </PersonPicker>
  );
}
