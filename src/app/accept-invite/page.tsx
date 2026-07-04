"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { validatePassword, PASSWORD_HELPER_TEXT } from "../../lib/passwordValidation";
import { checkPasswordNotBreached } from "@/lib/auth/breachedPassword";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthHeading, AuthError, TextField, PasswordField } from "@/components/auth/authPrimitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

type PageState = "loading" | "valid" | "expired" | "invalid";

interface InvitePreview {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string | null;
}

const INVITE_PANEL = {
  panelTitle: "Welcome to the team.",
  panelSubtitle: "Set up your account and you're in.",
};

function getDashboardPath(role: string): string {
  switch (role) {
    case "cleaner":
      return "/cleaner-dashboard";
    case "manager":
      return "/manager-dashboard";
    case "admin":
      return "/admin-dashboard";
    case "homeowner":
      return "/homeowner-dashboard";
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
    // included it in redirect_to when sending the invite.
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
          body: JSON.stringify({
            accessToken: session.access_token,
            inviteId: inviteIdFromQuery,
          }),
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
    // after exchanging the invite hash token.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        processSession(session);
      } else if (event === "TOKEN_REFRESHED" && session) {
        if (handled) {
          setAccessToken(session.access_token);
        } else {
          processSession(session);
        }
      }
    });

    // Fast-path: if the session is already present (e.g. page reload after exchange).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        processSession(session);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // When the form is rendered and the page is being hidden/torn down, beacon the
  // server so mark-expired knows the recipient closed the form. pagehide fires on
  // tab close + navigation away (incl. iOS Safari) but not on a routine blur.
  useEffect(() => {
    if (pageState !== "valid" || !invitePreview?.id) return;
    const id = invitePreview.id;
    const handlePageHide = () => {
      navigator.sendBeacon(`/api/invites/${id}/form-closed`);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [pageState, invitePreview?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!invitePreview) {
      setFormError("Invite is no longer valid. Please reload and try again.");
      return;
    }
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

    const { breached } = await checkPasswordNotBreached(password);
    if (breached) {
      setFormError("This password showed up in a data breach. Please choose a different one.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          inviteId: invitePreview.id,
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
        setFormError("Profile created, but sign-in failed: " + signInError.message);
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
      <AuthShell {...INVITE_PANEL}>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="size-8 animate-spin text-brand-600" />
          <p className="text-sm font-medium text-muted-foreground">Verifying your invite...</p>
        </div>
      </AuthShell>
    );
  }

  // ── Invalid / Expired state ────────────────────────────────────────────────
  if (pageState === "invalid" || pageState === "expired") {
    return (
      <AuthShell {...INVITE_PANEL}>
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-critical-50 text-critical-700">
            <AlertCircle className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              {pageState === "expired" ? "Invite expired" : "Invalid invite"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{pageError}</p>
          </div>
        </div>
      </AuthShell>
    );
  }

  // ── Valid state — show form ────────────────────────────────────────────────
  return (
    <AuthShell {...INVITE_PANEL}>
      <AuthHeading
        title={`Welcome to ${invitePreview?.organizationName ?? "the team"}`}
        subtitle="Complete your profile to access your dashboard."
      />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={formError} />
        <TextField id="email" label="Email address" type="email" value={userEmail} disabled />
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <div>
            <Badge variant="default">{formatRole(invitePreview?.role ?? "")}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            id="firstName"
            label="First name"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jane"
          />
          <TextField
            id="lastName"
            label="Last name"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Smith"
          />
        </div>
        <TextField
          id="phone"
          label="Phone (optional)"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 000-0000"
        />
        <PasswordField
          id="password"
          label="Create a password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          helper={PASSWORD_HELPER_TEXT}
        />
        <PasswordField
          id="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
        />
        <Button type="submit" size="lg" className="w-full" loading={isLoading}>
          {isLoading ? "Setting up your account..." : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="redesign font-jakarta grid min-h-screen place-items-center bg-background">
          <Loader2 className="size-8 animate-spin text-brand-600" />
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
