"use client";

import React, { useState } from "react";
import { X, Users, UserCheck, Loader2, Send, ShieldCheck } from "lucide-react";
import { inviteTeamMember } from "../hooks/useAdminData";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useToast } from "../contexts/ToastContext";

interface AddTeamMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTeamMemberCreated?: () => void;
}

export default function AddTeamMemberModal({
  isOpen,
  onClose,
  onTeamMemberCreated,
}: AddTeamMemberModalProps) {
  const { currentOrganizationId, accessToken } = useAuth();
  const { showToast } = useToast();

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"cleaner" | "manager" | "admin">("cleaner");
  const [emailError, setEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validateEmail = (emailValue: string): boolean => {
    if (!emailValue.trim()) {
      setEmailError("Email is required");
      return false;
    }
    if (!emailRegex.test(emailValue)) {
      setEmailError("Please enter a valid email address");
      return false;
    }
    setEmailError("");
    return true;
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    validateEmail(email);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    setEmail(newEmail);
    if (emailTouched) {
      validateEmail(newEmail);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    setSubmitError("");

    if (!validateEmail(email)) {
      return;
    }

    if (!currentOrganizationId) {
      setSubmitError("Organization ID is missing");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await inviteTeamMember({
        email: email.trim(),
        role,
        organizationId: currentOrganizationId,
        accessToken,
      });

      if (result.success) {
        showToast('Invite sent', {
          description: `Invitation email sent to ${email.trim()}`,
          variant: 'email',
        });

        // Reset form
        setEmail("");
        setRole("cleaner");
        setEmailError("");
        setEmailTouched(false);
        setSubmitError("");

        if (onTeamMemberCreated) {
          onTeamMemberCreated();
        }
        onClose();
      } else {
        setSubmitError(result.error || "Failed to create team member");
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isEmailValid = emailRegex.test(email) && email.trim() !== "";
  const isFormValid = isEmailValid && !isSubmitting;

  // Reset form when modal closes
  const handleClose = () => {
    setEmail("");
    setRole("cleaner");
    setEmailError("");
    setEmailTouched(false);
    setSubmitError("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-slide-up">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Users className="w-8 h-8 text-primary-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Invite Team Member
            </h2>
            <p className="text-gray-600">
              Send an invite to a new team member
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            {/* Role Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Role
              </label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setRole("cleaner")}
                  className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 transition-colors ${
                    role === "cleaner"
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <UserCheck className="w-5 h-5" />
                  <span className="font-medium">Cleaner</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole("manager")}
                  className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 transition-colors ${
                    role === "manager"
                      ? "border-primary-500 bg-primary-50 text-primary-700"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <Users className="w-5 h-5" />
                  <span className="font-medium">Manager</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole("admin")}
                  className={`flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 transition-colors ${
                    role === "admin"
                      ? "border-purple-500 bg-purple-50 text-purple-700"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <ShieldCheck className="w-5 h-5" />
                  <span className="font-medium">Admin</span>
                </button>
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
                className={`input-field ${
                  emailError && emailTouched
                    ? "border-red-500 focus:ring-red-500"
                    : ""
                }`}
                placeholder="Enter email address"
              />
              {emailError && emailTouched && (
                <p className="mt-1 text-sm text-red-600">{emailError}</p>
              )}
            </div>

            {/* Error Message */}
            {submitError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{submitError}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!isFormValid}
              className="btn-primary w-full flex justify-center items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send Invite</span>
                </>
              )}
            </button>
          </form>

          {/* Cancel Button */}
          <button
            onClick={handleClose}
            className="w-full bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
