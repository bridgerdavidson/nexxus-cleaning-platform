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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type AddCleanerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  /** Returns true when the invite was sent (the dialog then closes + resets). */
  onInvite: (email: string) => Promise<boolean>;
};

/** Minimal native "Invite cleaner" flow. Adding a cleaner sends a cleaner-role
 *  invite (the API contract is email-only); they appear in the roster once they
 *  accept and finish setting up their account. */
export function AddCleanerDialog({ open, onOpenChange, busy, onInvite }: AddCleanerDialogProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
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
    const ok = await onInvite(trimmed);
    if (ok) {
      reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite cleaner</DialogTitle>
          <DialogDescription>
            Send an invite. The cleaner joins your crew once they accept and set up their account.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <FormField
            label="Email"
            htmlFor="new-cleaner-email"
            required
            error={error ?? undefined}
            helper="We will email them a secure invite link."
          >
            <Input
              id="new-cleaner-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cleaner@email.com"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
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
