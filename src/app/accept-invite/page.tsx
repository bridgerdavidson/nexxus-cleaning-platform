"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Loader, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  validatePassword,
  PASSWORD_HELPER_TEXT,
} from "../../lib/passwordValidation";
import { AuthShell } from "../../components/auth/AuthShell";

type PageState = "loading" | "valid" | "expired" | "invalid";

interface InvitePreview {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string | null;
}

function getDashboardPath(role: string): string {
  switch (role) {
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

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function AcceptInviteContent() {
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [pageError, setPageError] = useState("");
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(
    null,
  );
  const [userEmail, setUserEmail] = useState("");
  const [accessToken, setAccessToken] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let handled = false;

    // Check for Supabase error params in the URL hash before attempting auth.
    // When an invite OTP is expired or invalid, Supabase redirects back with
    // #error=access_denied&error_code=otp_expired instead of an access_token.
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const hashError = hashParams.get("error");
    const hashErrorCode = hashParams.get("error_code");
    const hashErrorDesc = hashParams.get("error_description");

    // invite_id is preserved by Supabase on the error redirect because we
    // included it in redirect_to when sending the invite. Use it to flip
    // the DB row to 'expired' so the admin UI reflects reality.
    const queryParams = new URLSearchParams(window.location.search);
    const inviteIdFromQuery = queryParams.get("invite_id");

    if (hashError) {
      handled = true;
      if (hashErrorCode === "otp_expired") {
        setPageError(
          "This invite link has expired. Please ask an admin to send a new invite.",
        );
        setPageState("expired");
        if (inviteIdFromQuery) {
          // Fire-and-forget; failure here doesn't change the user-facing flow.
          fetch(`/api/invites/${inviteIdFromQuery}/mark-expired`, {
            method: "POST",
          }).catch(() => {});
        }
      } else {
        setPageError(
          hashErrorDesc
            ? decodeURIComponent(hashErrorDesc.replace(/\+/g, " "))
            : "This invite link is invalid or has already been used.",
        );
        setPageState("invalid");
      }
      return;
    }

    async function processSession(session: {
      user: { email?: string };
      access_token: string;
    }) {
      if (handled) return;
      handled = true;

      const email = session.user.email;
      if (!email) {
        setPageError("No email found in invite token.");
        setPageState("invalid");
        return;
      }

      setUserEmail(email);
      setAccessToken(session.access_token);

      try {
        // Validate invite server-side — supabaseAdmin bypasses RLS
        const response = await fetch("/api/accept-invite/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: session.access_token }),
        });

        const result = await response.json();

        if (!result.success) {
          if (result.status === "expired") {
            setPageError(
              result.message ||
                "This invite has expired. Please ask an admin to send a new invite.",
            );
            setPageState("expired");
          } else {
            setPageError(
              result.message ||
                "This invite link is invalid or has already been used.",
            );
            setPageState("invalid");
          }
          return;
        }

        setInvitePreview(result.invite as InvitePreview);
        setPageState("valid");
      } catch {
        setPageError("An unexpected error occurred. Please try again.");
        setPageState("invalid");
      }
    }

    // Primary: listen for the SIGNED_IN event that detectSessionInUrl fires
    // after exchanging the invite hash token — this handles the async timing gap.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        processSession(session);
      }
    });

    // Fast-path: if the session is already present (e.g. page reload after exchange),
    // we don't need to wait for the auth state change event.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        processSession(session);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!firstName.trim() || !lastName.trim()) {
      setFormError("First and last name are required.");
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setFormError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          password,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setFormError(
          result.error || "Failed to complete profile. Please try again.",
        );
        return;
      }

      // Sign in with the newly set password to get a fresh session
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password,
      });

      if (signInError) {
        setFormError(
          "Profile created, but sign-in failed: " + signInError.message,
        );
        return;
      }

      router.push(getDashboardPath(result.role));
    } catch {
      setFormError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <AuthShell badge="Team Invitation">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          <p className="text-sm font-medium text-gray-500">
            Verifying your invite…
          </p>
        </div>
      </AuthShell>
    );
  }

  // ── Invalid / Expired state ────────────────────────────────────────────────
  if (pageState === "invalid" || pageState === "expired") {
    return (
      <AuthShell badge="Team Invitation">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="rounded-xl border border-red-100 bg-red-50 p-3 ring-1 ring-red-100/60">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-gray-900">
              {pageState === "expired" ? "Invite Expired" : "Invalid Invite"}
            </h2>
            <p className="mt-2 text-sm text-gray-500">{pageError}</p>
          </div>
        </div>
      </AuthShell>
    );
  }

  // ── Valid state — show form ────────────────────────────────────────────────
  return (
    <AuthShell badge="Team Invitation">
        {/* Card header */}
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">
            Welcome to {invitePreview?.organizationName ?? "the team"}
          </h2>
          <p className="mt-1.5 text-sm text-gray-500">
            Complete your profile to access your dashboard.
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          {formError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100/60">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </div>
          )}

          {/* Email — disabled */}
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
              value={userEmail}
              disabled
              className="input-field bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          {/* Role — read-only badge */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Role
            </label>
            <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-700 ring-1 ring-primary-100/60">
              {formatRole(invitePreview?.role ?? "")}
            </span>
          </div>

          {/* First + Last name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="firstName"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                First name
              </label>
              <input
                id="firstName"
                type="text"
                required
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="input-field"
                placeholder="Jane"
              />
            </div>
            <div>
              <label
                htmlFor="lastName"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                required
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="input-field"
                placeholder="Smith"
              />
            </div>
          </div>

          {/* Phone — optional */}
          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Phone number{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input-field"
              placeholder="(555) 000-0000"
            />
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Create a password
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
            />
            <p className="mt-1.5 text-xs text-gray-500">{PASSWORD_HELPER_TEXT}</p>
          </div>

          {/* Confirm password */}
          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Confirm password
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
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  <span>Setting up your account…</span>
                </>
              ) : (
                <span>Complete Profile &amp; Go to Dashboard</span>
              )}
            </button>
          </div>
        </form>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
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
      <AcceptInviteContent />
    </Suspense>
  );
}
