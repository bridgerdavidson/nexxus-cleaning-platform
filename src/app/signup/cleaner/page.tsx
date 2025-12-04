"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../hooks/useAuth";
import { Eye, EyeOff, Loader, ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import CleanerProfileModal from "../../../components/CleanerProfileModal";

export default function CleanerSignup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [waitingForUser, setWaitingForUser] = useState(false);
  const isInSignupFlowRef = useRef(false);
  const fallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Refs to track current state values for timeout callback (avoid closure issues)
  const waitingForUserRef = useRef(false);
  const showProfileModalRef = useRef(false);
  const userRef = useRef<typeof user>(null);

  const { signUp, signIn, user, loading, accessToken } = useAuth();
  const router = useRouter();

  // Note: Tab visibility handling is in LayoutWrapper (global)
  // No need to add it here - would cause multiple listeners

  // Keep refs in sync with state
  useEffect(() => {
    waitingForUserRef.current = waitingForUser;
  }, [waitingForUser]);

  useEffect(() => {
    showProfileModalRef.current = showProfileModal;
  }, [showProfileModal]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Watch for user state after successful sign-in
  // Show modal as soon as user is available during signup flow, regardless of loading state
  useEffect(() => {
    // Open modal when we're waiting and user is available
    // Removed strict !loading requirement to make it more reliable
    if (waitingForUser && user?.id) {
      console.log("[CleanerSignup] Opening profile modal for new user", {
        userId: user.id,
        loading,
        waitingForUser,
        isInSignupFlow: isInSignupFlowRef.current,
      });
      // Clear any pending fallback timeout
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
      // Set modal first, then clear waiting flag
      // The ref prevents redirect during this transition
      setShowProfileModal(true);
      setWaitingForUser(false);
    } else if (waitingForUser) {
      // Log when we're waiting but conditions aren't met yet
      console.log("[CleanerSignup] Waiting for user after signup", {
        hasUser: !!user?.id,
        userId: user?.id,
        loading,
        waitingForUser,
      });
    }
  }, [user, loading, waitingForUser]);

  // Fallback effect: If we're waiting for user and it's been a while, check again
  // This handles cases where user state might not update immediately
  useEffect(() => {
    if (waitingForUser && isInSignupFlowRef.current) {
      // Set up a fallback timeout to ensure modal shows even if user state is delayed
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
      }
      fallbackTimeoutRef.current = setTimeout(() => {
        // Use refs to get current state values (avoid closure issues)
        const currentWaiting = waitingForUserRef.current;
        const currentUser = userRef.current;
        const currentModal = showProfileModalRef.current;
        
        // Check current state - if we still have user and are waiting, show modal
        if (currentWaiting && currentUser?.id && !currentModal && isInSignupFlowRef.current) {
          console.log("[CleanerSignup] Fallback: Opening modal after timeout", {
            hasUser: !!currentUser?.id,
            userId: currentUser?.id,
            waiting: currentWaiting,
            modal: currentModal,
          });
          setShowProfileModal(true);
          setWaitingForUser(false);
        } else {
          console.log("[CleanerSignup] Fallback timeout: Conditions not met", {
            hasUser: !!currentUser?.id,
            userId: currentUser?.id,
            waiting: currentWaiting,
            modal: currentModal,
            inSignupFlow: isInSignupFlowRef.current,
          });
        }
        fallbackTimeoutRef.current = null;
      }, 2000); // 2 second fallback

      return () => {
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
      };
    }
  }, [waitingForUser, user, showProfileModal]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
      }
    };
  }, []);

  // Separate effect for redirection - handles the case where an already-logged-in user visits the signup page
  // This should NOT run during the signup flow (when waitingForUser is true or modal is showing)
  useEffect(() => {
    // Only redirect if user exists and we're not in the signup flow
    // Use ref to prevent redirect during signup-to-modal transition (avoids race condition)
    // The modal's onClose handler will handle the redirect after profile completion
    if (user && !showProfileModal && !waitingForUser && !loading && !isInSignupFlowRef.current) {
      console.log(
        "[CleanerSignup] User already logged in, redirecting to dashboard"
      );
      router.push("/cleaner-dashboard");
    }
  }, [user, loading, showProfileModal, waitingForUser, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    // Validation
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long");
      setIsLoading(false);
      return;
    }

    try {
      const result = await signUp(email, password, {
        firstName,
        lastName,
        role: "cleaner",
      });

      if (result.error) {
        setError(result.error);
        isInSignupFlowRef.current = false; // Clear ref on error
        setWaitingForUser(false);
        // Clear any pending timeout
        if (fallbackTimeoutRef.current) {
          clearTimeout(fallbackTimeoutRef.current);
          fallbackTimeoutRef.current = null;
        }
      } else {
        console.log("[CleanerSignup] Signup successful, waiting for user state", {
          role: result.role,
        });
        // Set waiting flag to show loading state while profile loads
        // Set ref to prevent redirect during signup flow
        isInSignupFlowRef.current = true;
        setWaitingForUser(true);

        // signUp now automatically signs in the user
        // The useEffect will detect the user and show profile modal
        // Note: Fallback timeout is handled in a separate useEffect below
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <CleanerProfileModal
        isOpen={showProfileModal && !!user?.id}
        onClose={() => {
          setShowProfileModal(false);
          isInSignupFlowRef.current = false; // Clear ref when modal closes
          router.push("/cleaner-dashboard");
        }}
        userId={user?.id || ""}
        accessToken={accessToken}
      />
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <Link
            href="/signup"
            className="inline-flex items-center text-gray-600 hover:text-primary-600 mb-4 transition-colors justify-center"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to role selection
          </Link>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-success-100 rounded-full mb-4">
              <Sparkles className="w-8 h-8 text-success-600" />
            </div>
            <h1 className="text-3xl font-bold text-primary-600">Nexxus</h1>
            <p className="text-sm text-gray-600 mt-1">Cleaning Solutions</p>
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
            Join as a Cleaner
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Start accepting cleaning jobs and grow your business
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <form className="space-y-6" onSubmit={handleSubmit}>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="firstName"
                    className="block text-sm font-medium text-gray-700"
                  >
                    First Name
                  </label>
                  <div className="mt-1">
                    <input
                      id="firstName"
                      name="firstName"
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="input-field"
                      placeholder="First name"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="lastName"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Last Name
                  </label>
                  <div className="mt-1">
                    <input
                      id="lastName"
                      name="lastName"
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="input-field"
                      placeholder="Last name"
                    />
                  </div>
                </div>
              </div>

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
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700"
                >
                  Password
                </label>
                <div className="mt-1 relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="Enter your password"
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
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700"
                >
                  Confirm Password
                </label>
                <div className="mt-1 relative">
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="Confirm your password"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
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
                  className="btn-primary w-full flex justify-center items-center space-x-2"
                >
                  {isLoading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>Creating account...</span>
                    </>
                  ) : (
                    <span>Create Account</span>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-medium text-primary-600 hover:text-primary-500"
                >
                  Sign in here
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
