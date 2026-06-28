"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ProfileRow } from "./ProfileRow";

/** A "Change password" row that confirms, then triggers the existing
 *  password-recovery email (no in-app password surface needed). */
export function ChangePasswordDialog({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: `${window.location.origin}/reset-password` }),
      });
      if (!res.ok) throw new Error("Request failed");
      toast.success("Check your email", {
        description: `We sent a password reset link to ${email}.`,
      });
      setOpen(false);
    } catch {
      toast.error("Could not send the reset link", {
        description: "Please try again in a moment.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <ProfileRow
        icon={Lock}
        title="Change password"
        subtitle="We'll email you a reset link"
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onOpenChange={(v) => !sending && setOpen(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              We&apos;ll email a password reset link to{" "}
              <span className="font-semibold text-foreground">{email}</span>. Open it to set a new
              password.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={sending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={send} loading={sending}>
              Send reset link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
