"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { AlertCircle, Eye, EyeOff, Loader } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "../../components/auth/AuthShell";

function LoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { signIn, user, isCleaningUp, isPlatformAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Redirect if already logged in. Wait for the platform-admin check to
    // resolve (non-null) so a platform admin lands on /owner instead of being
    // briefly bounced to a tenant dashboard.
    if (user && isPlatformAdmin !== null) {
      router.push(isPlatformAdmin ? "/owner" : getDashboardPath(user.role));
    }
  }, [user, isPlatformAdmin, router]);

  const getDashboardPath = (userRole: string) => {
    switch (userRole) {
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
  };

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
    <AuthShell badge="Sign In">
      {/* Card header */}
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Welcome back
        </h2>
        <p className="mt-1.5 text-sm text-gray-500">
          Sign in to your account to continue.
        </p>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100/60"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
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
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="Enter your email"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 mb-1.5"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field pr-10"
              placeholder="Enter your password"
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
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

        <div className="flex items-center justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary-600 hover:text-primary-500"
          >
            Forgot your password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={isLoading || isCleaningUp}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              <span>Signing in...</span>
            </>
          ) : isCleaningUp ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              <span>Please wait...</span>
            </>
          ) : (
            <span>Sign in</span>
          )}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
