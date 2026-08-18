"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthHeading, AuthError, TextField } from "@/components/auth/authPrimitives";
import { Button } from "@/components/ui/button";
import { useToast } from "../../contexts/ToastContext";

type Status = "idle" | "submitting" | "submitted";

function ForgotPasswordContent() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [clientError, setClientError] = useState("");
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError("");

    const trimmed = email.trim();
    if (!trimmed) {
      setClientError("Please enter your email.");
      return;
    }

    setStatus("submitting");

    // Always transition to "submitted" — never branch UI on the result so we
    // don't leak whether the email exists. The reset is triggered server-side so a
    // provider/SMTP send failure can page the platform owner; the user still sees
    // the same generic screen. Network/other errors are swallowed for the same
    // anti-enumeration reason.
    const redirectTo = `${window.location.origin}/reset-password`;
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, redirectTo }),
      });
    } catch (err) {
      console.warn("forgot-password request failed (suppressed):", err);
    }

    showToast("Check your email for a reset link", { variant: "email" });
    setStatus("submitted");
  };

  // ── Submitted (success / error — same UX) ────────────────────────────────
  if (status === "submitted") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-brand-50 text-brand-ink">
            <Mail className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              If an account exists for{" "}
              <span className="font-semibold text-foreground">{email.trim()}</span>, we sent a password reset link. Check your inbox (and spam), it expires in 1 hour.
            </p>
          </div>
          <Link href="/login" className="mt-1 text-sm font-semibold text-brand-ink hover:text-brand-700">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  // ── Idle / submitting ─────────────────────────────────────────────────────
  return (
    <AuthShell>
      <AuthHeading title="Reset your password" subtitle="Enter your email and we'll send you a link to set a new one." />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={clientError} />
        <TextField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          disabled={status === "submitting"}
        />
        <Button type="submit" size="lg" className="w-full" loading={status === "submitting"}>
          Send reset link
        </Button>
        <div className="text-center">
          <Link href="/login" className="text-sm font-semibold text-brand-ink hover:text-brand-700">
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="redesign font-jakarta grid min-h-screen place-items-center bg-background">
          <Loader2 className="size-8 animate-spin text-brand-ink" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
