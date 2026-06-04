"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Users } from "lucide-react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useDismissGuard } from "../hooks/useDismissGuard";
import { useAuth } from "../hooks/useAuth";
import { useFormDraft } from "../hooks/useFormDraft";
import { createDraftStore } from "@/lib/formDraft";
import DiscardChangesDialog from "./DiscardChangesDialog";

interface AddCleanerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// --- Reload-restore draft -----------------------------------------------------------
// The add-cleaner form's in-progress input, persisted to sessionStorage so a full page
// reload (or an accidental navigation and return) restores it. A 6h TTL + org check (in
// the store) keep a draft from resurrecting stale or across tenants. Zero server cost.
interface CleanerDraftBody {
  firstName: string;
  lastName: string;
  email: string;
}

const INITIAL_CLEANER_DRAFT: CleanerDraftBody = {
  firstName: "",
  lastName: "",
  email: "",
};

const cleanerDraftStore = createDraftStore<CleanerDraftBody>({
  key: "nexxus.cleanerDraft.v1",
  version: 1,
  initial: INITIAL_CLEANER_DRAFT,
});

export default function AddCleanerModal({
  isOpen,
  onClose,
}: AddCleanerModalProps) {
  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  const { currentOrganizationId } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);

  // --- Reload-restore wiring --------------------------------------------------------
  const persistEligible = true;

  const draftBody = useMemo<CleanerDraftBody>(
    () => ({ firstName, lastName, email }),
    [firstName, lastName, email],
  );

  useFormDraft({
    store: cleanerDraftStore,
    orgId: currentOrganizationId,
    isOpen,
    eligible: persistEligible,
    body: draftBody,
  });

  // Restore a saved draft once per open (after the org id resolves).
  const draftHydratedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      draftHydratedRef.current = false;
      return;
    }
    if (draftHydratedRef.current || !persistEligible || !currentOrganizationId) {
      return;
    }
    draftHydratedRef.current = true;
    const draft = cleanerDraftStore.load(currentOrganizationId);
    if (!draft) return;
    setFirstName(draft.firstName);
    setLastName(draft.lastName);
    setEmail(draft.email);
  }, [isOpen, persistEligible, currentOrganizationId]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);

    if (!validateEmail(email)) {
      return;
    }

    // Placeholder for future AWS SES integration
    // For now, this button does nothing
    console.log("Send sign up link clicked", { firstName, lastName, email });
  };

  const isEmailValid = emailRegex.test(email) && email.trim() !== "";
  const isFormValid =
    firstName.trim() !== "" && lastName.trim() !== "" && isEmailValid;

  // Reset form when modal closes
  const handleClose = () => {
    // A deliberate close drops the saved draft (it only exists to survive a reload).
    cleanerDraftStore.clear();
    setFirstName("");
    setLastName("");
    setEmail("");
    setEmailError("");
    setEmailTouched(false);
    onClose();
  };

  const isDirty =
    firstName.trim() !== "" ||
    lastName.trim() !== "" ||
    email.trim() !== "";
  const guard = useDismissGuard({
    isOpen,
    isDirty,
    onConfirmClose: handleClose,
  });

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={guard.requestClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-slide-up">
          {/* Close button */}
          <button
            onClick={guard.requestClose}
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
              Add New Cleaner
            </h2>
            <p className="text-gray-600">
              Send a sign up link to invite a new cleaner
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            {/* First Name and Last Name in Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="firstName"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  First Name
                </label>
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

              <div>
                <label
                  htmlFor="lastName"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Last Name
                </label>
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

            {/* Send Button */}
            <button
              type="submit"
              disabled={!isFormValid}
              className="btn-primary w-full flex justify-center items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Send sign up link</span>
            </button>
          </form>

          {/* Cancel Button */}
          <button
            onClick={guard.requestClose}
            className="w-full bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
    <DiscardChangesDialog
      isOpen={guard.confirmOpen}
      onConfirm={guard.confirmDiscard}
      onCancel={guard.cancelDiscard}
    />
    </>
  );
}
