"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader, UserCheck, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";

type PageState = "loading" | "valid" | "expired" | "invalid";

interface InvitePreview {
  id: string;
  email: string;
  role: string;
  organizationId: string;
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
          <p className="text-gray-600">Verifying your invite...</p>
        </div>
      </div>
    );
  }

  // ── Invalid / Expired state ────────────────────────────────────────────────
  if (pageState === "invalid" || pageState === "expired") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-primary-600">Nexxus</h1>
            <p className="text-sm text-gray-600 mt-1">Cleaning Solutions</p>
          </div>
        </div>
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {pageState === "expired" ? "Invite Expired" : "Invalid Invite"}
              </h2>
              <p className="text-sm text-gray-600">{pageError}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Valid state — show form ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <UserCheck className="w-8 h-8 text-primary-600" />
          </div>
          <h1 className="text-3xl font-bold text-primary-600">Nexxus</h1>
          <p className="text-sm text-gray-600 mt-1">Cleaning Solutions</p>
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
          Welcome to the team!
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Complete your profile to access your dashboard.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                {formError}
              </div>
            )}

            {/* Email — disabled */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  type="email"
                  value={userEmail}
                  disabled
                  className="input-field bg-gray-50 text-gray-500 cursor-not-allowed"
                />
              </div>
            </div>

            {/* Role — read-only badge */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-700 border border-primary-200">
                {formatRole(invitePreview?.role ?? "")}
              </span>
            </div>

            {/* First + Last name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="firstName"
                  className="block text-sm font-medium text-gray-700"
                >
                  First name
                </label>
                <div className="mt-1">
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
              </div>
              <div>
                <label
                  htmlFor="lastName"
                  className="block text-sm font-medium text-gray-700"
                >
                  Last name
                </label>
                <div className="mt-1">
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
            </div>

            {/* Phone — optional */}
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-gray-700"
              >
                Phone number{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="mt-1">
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
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Create a password
              </label>
              <div className="mt-1 relative">
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
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full flex justify-center items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>Setting up your account...</span>
                  </>
                ) : (
                  <span>Complete Profile &amp; Go to Dashboard</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
