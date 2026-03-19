"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";

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

/* ── Shared background shell ─────────────────────────────────────────── */
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-100 flex items-center justify-center px-4 py-12">

      <div className="relative z-10 w-full max-w-md">
        {/* Wordmark */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-primary-600">
            Nexxus
          </h1>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-white/80 px-3 py-1 text-xs font-semibold text-primary-700 shadow-sm">
            Team Invitation
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

/* ── Glass card wrapper ───────────────────────────────────────────────── */
function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/80 px-8 py-8 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
      {children}
    </div>
  );
}

function AcceptInviteContent() {
  const router = useRouter();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [pageError, setPageError] = useState("");
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [accessToken, setAccessToken] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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

    if (hashError) {
      handled = true;
      if (hashErrorCode === "otp_expired") {
        setPageError(
          "This invite link has expired. Please ask an admin to send a new invite.",
        );
        setPageState("expired");
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
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
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
      <PageShell>
        <GlassCard>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            <p className="text-sm font-medium text-gray-500">Verifying your invite…</p>
          </div>
        </GlassCard>
      </PageShell>
    );
  }

  // ── Invalid / Expired state ────────────────────────────────────────────────
  if (pageState === "invalid" || pageState === "expired") {
    return (
      <PageShell>
        <GlassCard>
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
        </GlassCard>
      </PageShell>
    );
  }

  // ── Valid state — show form ────────────────────────────────────────────────
  return (
    <PageShell>
      <GlassCard>
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
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
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
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1.5">
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
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1.5">
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
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1.5">
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
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
              Create a password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pr-10"
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>
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
      </GlassCard>
    </PageShell>
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
