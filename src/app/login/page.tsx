"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { AuthShell } from "@/components/auth/AuthShell";
import { AuthHeading, AuthError, TextField, PasswordField } from "@/components/auth/authPrimitives";
import { Button } from "@/components/ui/button";
import { getDashboardPath } from "@/lib/redesign/dashboardPath";

function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { signIn, user, isCleaningUp, isPlatformAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Redirect if already logged in. Wait for the platform-admin check to
    // resolve (non-null) so a platform admin lands on the owner back-office
    // instead of being briefly bounced to a tenant dashboard.
    if (user && isPlatformAdmin !== null) {
      router.push(isPlatformAdmin ? "/owner" : getDashboardPath(user.role));
    }
  }, [user, isPlatformAdmin, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      }
      // Don't redirect here - let the useEffect handle it when user state updates
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell>
      <AuthHeading title="Welcome back" subtitle="Sign in to your account to continue." />
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={error} />
        <TextField
          id="email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
        />
        <PasswordField
          id="password"
          name="password"
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-semibold text-brand-ink hover:text-brand-700">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={isLoading || isCleaningUp}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="redesign font-jakarta grid min-h-screen place-items-center bg-background">
          <Loader2 className="size-8 animate-spin text-brand-ink" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
