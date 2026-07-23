"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthHeading, AuthError, PasswordField } from "@/components/auth/authPrimitives";
import { Button } from "@/components/ui/button";
import { validatePassword, PASSWORD_HELPER_TEXT } from "../../lib/passwordValidation";
import { checkPasswordNotBreached } from "@/lib/auth/breachedPassword";
import { useToast } from "../../contexts/ToastContext";
import { getDashboardPath } from "@/lib/redesign/dashboardPath";

type PageState = "loading" | "expired" | "invalid" | "form" | "success";

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
        setPageError("This password reset link has expired. Please request a new one.");
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
        (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
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

    const { breached } = await checkPasswordNotBreached(password);
    if (breached) {
      setFormError("This password showed up in a data breach. Please choose a different one.");
      setIsSubmitting(false);
      return;
    }

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

    // Prefer user_profiles.role — auth metadata is empty for users created
    // via invite (accept-invite writes role to user_profiles only), so the
    // old metadata-only path silently routed admins/managers to homeowner.
    const u = data.user;
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", u.id)
      .maybeSingle();

    const role =
      (profile?.role as string | undefined) ||
      (u.app_metadata?.role as string | undefined) ||
      (u.user_metadata?.role as string | undefined) ||
      null;

    showToast("Password updated. Welcome back.", { variant: "success" });

    setTimeout(() => {
      router.push(role ? getDashboardPath(role) : "/");
    }, 250);
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="size-8 animate-spin text-brand-600" />
          <p className="text-sm font-medium text-muted-foreground">Verifying your reset link...</p>
        </div>
      </AuthShell>
    );
  }

  // ── Expired / Invalid state ───────────────────────────────────────────────
  if (pageState === "expired" || pageState === "invalid") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-critical-50 text-critical-700">
            <AlertCircle className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              {pageState === "expired" ? "Link expired" : "Invalid link"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{pageError}</p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Link href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  // ── Success state (transient — redirects in 250ms) ────────────────────────
  if (pageState === "success") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="size-8 animate-spin text-brand-600" />
          <p className="text-sm font-medium text-muted-foreground">Password updated. Redirecting...</p>
        </div>
      </AuthShell>
    );
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <AuthShell>
      <AuthHeading title="Set a new password" subtitle="Choose a new password for your account." />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={formError} />
        <PasswordField
          id="password"
          label="New password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          helper={PASSWORD_HELPER_TEXT}
          disabled={isSubmitting}
        />
        <PasswordField
          id="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
          disabled={isSubmitting}
        />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? "Updating password..." : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="redesign font-jakarta grid min-h-screen place-items-center bg-background">
          <Loader2 className="size-8 animate-spin text-brand-600" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
