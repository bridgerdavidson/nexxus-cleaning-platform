"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type StaffInviteRole = "manager" | "admin";

export type AddStaffDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  /** Returns true when the invite was sent (the dialog then closes + resets). */
  onInvite: (email: string, role: StaffInviteRole) => Promise<boolean>;
};

/** Invite a manager or admin. Only rendered for owners/admins (a manager cannot
 *  invite other staff), so both roles are offered here. */
export function AddStaffDialog({ open, onOpenChange, busy, onInvite }: AddStaffDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffInviteRole>("manager");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setRole("manager");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    const ok = await onInvite(trimmed, role);
    if (ok) {
      reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Send an invite. They join your team once they accept and set up their account.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <FormField
            label="Email"
            htmlFor="new-staff-email"
            required
            error={error ?? undefined}
            helper="We will email them a secure invite link."
          >
            <Input
              id="new-staff-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@email.com"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </FormField>

          <FormField label="Role" htmlFor="new-staff-role" helper="Admins have full access. Managers get the permissions you choose.">
            <Select value={role} onValueChange={(v) => setRole(v as StaffInviteRole)}>
              <SelectTrigger id="new-staff-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            <UserPlus /> Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
