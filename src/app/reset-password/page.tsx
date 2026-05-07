"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "../../components/auth/AuthShell";
import {
  validatePassword,
  PASSWORD_HELPER_TEXT,
} from "../../lib/passwordValidation";
import { useToast } from "../../contexts/ToastContext";

type PageState = "loading" | "expired" | "invalid" | "form" | "success";

function getDashboardPath(role: string): string {
  switch (role) {
    case "homeowner":
      return "/homeowner-dashboard";
    case "cleaner":
      return "/cleaner-dashboard";
    case "manager":
      return "/manager-dashboard";
    case "admin":
      return "/admin-dashboard";
    default:
      return "/";
  }
}

function ResetPasswordContent() {
  const router = useRouter();
  const { showToast } = useToast();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [pageError, setPageError] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Detect recovery session / hash error on mount ───────────────────────────
  useEffect(() => {
    let handled = false;

    // 1. Hash error fast-check — Supabase redirects with #error=... when the
    //    OTP is expired/invalid. Mirrors accept-invite's pattern.
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const hashError = hashParams.get("error");
    const hashErrorCode = hashParams.get("error_code");
    const hashErrorDesc = hashParams.get("error_description");

    if (hashError) {
      handled = true;
      if (hashErrorCode === "otp_expired") {
        setPageError(
          "This password reset link has expired. Please request a new one.",
        );
        setPageState("expired");
      } else {
        setPageError(
          hashErrorDesc
            ? decodeURIComponent(hashErrorDesc.replace(/\+/g, " "))
            : "This password reset link is invalid or has already been used.",
        );
        setPageState("invalid");
      }
      return;
    }

    // 2. onAuthStateChange — Supabase fires PASSWORD_RECOVERY (or SIGNED_IN
    //    on older versions) once detectSessionInUrl exchanges the hash token.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (handled) return;
      if (
        (event === "PASSWORD_RECOVERY" ||
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED") &&
        session
      ) {
        handled = true;
        setPageState("form");
      }
    });

    // 3. Fast-path getSession() — if the hash exchange already completed
    //    (e.g. page reload after exchange), skip waiting for the listener.
    //    Also handles the "already signed in, navigated here directly" case.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (handled) return;
      if (session) {
        handled = true;
        setPageState("form");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const passwordError = validatePassword(password);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const { data, error } = await supabase.auth.updateUser({ password });

    if (error || !data.user) {
      setIsSubmitting(false);
      setFormError(
        error?.message ||
          "Failed to update password. Please try again or request a new reset link.",
      );
      return;
    }

    setPageState("success");

    // Read role from auth metadata (matches getRoleFromAuth in AuthContext).
    const u = data.user;
    const role =
      ((u.app_metadata?.role as string) ||
        (u.user_metadata?.role as string) ||
        "homeowner") as string;

    showToast("Password updated. Welcome back.", { variant: "success" });

    // Brief delay so the toast registers before navigation.
    setTimeout(() => {
      router.push(getDashboardPath(role));
    }, 250);
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <AuthShell badge="Reset Password">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          <p className="text-sm font-medium text-gray-500">
            Verifying your reset link…
          </p>
        </div>
      </AuthShell>
    );
  }

  // ── Expired / Invalid state ───────────────────────────────────────────────
  if (pageState === "expired" || pageState === "invalid") {
    return (
      <AuthShell badge="Reset Password">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3 ring-1 ring-red-100/60">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">
              {pageState === "expired" ? "Link Expired" : "Invalid Link"}
            </h2>
            <p className="mt-2 text-sm text-gray-500">{pageError}</p>
          </div>
          <Link
            href="/forgot-password"
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Request a new link
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-primary-600 hover:text-primary-500"
          >
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  // ── Success state (transient — redirects in 250ms) ────────────────────────
  if (pageState === "success") {
    return (
      <AuthShell badge="Reset Password">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          <p className="text-sm font-medium text-gray-500">
            Password updated. Redirecting…
          </p>
        </div>
      </AuthShell>
    );
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <AuthShell badge="Reset Password">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Set a new password
        </h2>
        <p className="mt-1.5 text-sm text-gray-500">
          Choose a strong password for your account.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {formError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100/60">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {formError}
          </div>
        )}

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
            placeholder="At least 8 characters"
            disabled={isSubmitting}
          />
          <p className="mt-1.5 text-xs text-gray-500">{PASSWORD_HELPER_TEXT}</p>
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-field [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
            placeholder="Re-enter your password"
            disabled={isSubmitting}
          />
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                <span>Updating password…</span>
              </>
            ) : (
              <span>Update password</span>
            )}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
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
      <ResetPasswordContent />
    </Suspense>
  );
}
