"use client";

import React, { Suspense, useState } from "react";
import Link from "next/link";
import { Loader, Loader2, Mail, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "../../components/auth/AuthShell";
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
    // don't leak whether the email exists. Rate-limit errors are also swallowed.
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo,
    });

    if (error) {
      console.warn("resetPasswordForEmail error (suppressed):", error);
    }

    showToast("Check your email for a reset link", { variant: "email" });
    setStatus("submitted");
  };

  // ── Submitted (success / error — same UX) ────────────────────────────────
  if (status === "submitted") {
    return (
      <AuthShell badge="Forgot Password">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="rounded-xl border border-primary-100 bg-primary-50 p-3 ring-1 ring-primary-100/60">
            <Mail className="h-7 w-7 text-primary-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">
              Check your email
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              If an account exists for{" "}
              <span className="font-medium text-gray-700">{email.trim()}</span>,
              we&apos;ve sent a password reset link. Please check your inbox
              (and spam folder) — the link will expire in 1 hour.
            </p>
          </div>
          <Link
            href="/login"
            className="mt-2 text-sm font-semibold text-primary-600 hover:text-primary-500"
          >
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  // ── Idle / submitting ─────────────────────────────────────────────────────
  return (
    <AuthShell badge="Forgot Password">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Reset your password
        </h2>
        <p className="mt-1.5 text-sm text-gray-500">
          Enter the email associated with your account and we&apos;ll send you a
          link to set a new password.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {clientError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100/60">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {clientError}
          </div>
        )}

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="you@example.com"
            disabled={status === "submitting"}
          />
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={status === "submitting"}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "submitting" ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                <span>Sending…</span>
              </>
            ) : (
              <span>Send reset link</span>
            )}
          </button>
        </div>

        <div className="text-center">
          <Link
            href="/login"
            className="text-sm font-medium text-primary-600 hover:text-primary-500"
          >
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
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            <p className="text-sm font-medium text-gray-500">Loading…</p>
          </div>
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
