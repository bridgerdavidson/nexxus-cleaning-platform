"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { X, Users, Phone, Loader2, Send } from "lucide-react";
import { inviteTeamMember } from "../hooks/useAdminData";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useDismissGuard } from "../hooks/useDismissGuard";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { useFormDraft } from "../hooks/useFormDraft";
import { createDraftStore } from "@/lib/formDraft";
import DiscardChangesDialog from "./DiscardChangesDialog";

interface AddCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCustomerCreated?: () => void;
}

// --- Reload-restore draft -----------------------------------------------------------
// The add-customer form's in-progress text, persisted to sessionStorage so a full page reload
// (or an accidental navigation and return) restores it. Only user-typed scalar fields are
// stored; validation/touched flags are derived and recomputed on blur. A 6h TTL + org check
// (in the store) keep a draft from resurrecting stale or across tenants. Zero server cost.
interface CustomerDraftBody {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

const INITIAL_CUSTOMER_DRAFT: CustomerDraftBody = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

const customerDraftStore = createDraftStore<CustomerDraftBody>({
  key: "nexxus.customerDraft.v1",
  version: 1,
  initial: INITIAL_CUSTOMER_DRAFT,
});

export default function AddCustomerModal({
  isOpen,
  onClose,
  onCustomerCreated,
}: AddCustomerModalProps) {
  const { currentOrganizationId, accessToken } = useAuth();
  const { showToast } = useToast();

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // --- Reload-restore wiring --------------------------------------------------------
  // Plain create flow with no preselection, so persistence is always eligible (still gated on
  // an org id inside the store/hook).
  const persistEligible = true;

  const draftBody = useMemo<CustomerDraftBody>(
    () => ({ firstName, lastName, email, phone }),
    [firstName, lastName, email, phone],
  );

  useFormDraft({
    store: customerDraftStore,
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
    const draft = customerDraftStore.load(currentOrganizationId);
    if (!draft) return;
    setFirstName(draft.firstName);
    setLastName(draft.lastName);
    setEmail(draft.email);
    setPhone(draft.phone);
  }, [isOpen, persistEligible, currentOrganizationId]);

  // Email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  // Phone validation regex (allows various formats)
  const phoneRegex = /^[\d\s\-\(\)\+]{10,}$/;

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

  const validatePhone = (phoneValue: string): boolean => {
    if (!phoneValue.trim()) {
      setPhoneError(""); // Phone is optional
      return true;
    }
    if (!phoneRegex.test(phoneValue)) {
      setPhoneError("Please enter a valid phone number");
      return false;
    }
    setPhoneError("");
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

  const handlePhoneBlur = () => {
    setPhoneTouched(true);
    validatePhone(phone);
  };

  const formatPhoneNumber = (value: string): string => {
    // Remove all non-digit characters
    const digits = value.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX for US numbers
    if (digits.length <= 3) {
      return digits;
    } else if (digits.length <= 6) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else if (digits.length <= 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    } else {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
  };

  const handlePhoneInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formattedPhone = formatPhoneNumber(e.target.value);
    setPhone(formattedPhone);
    if (phoneTouched) {
      validatePhone(formattedPhone);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    setPhoneTouched(true);
    setSubmitError("");

    const isEmailValid = validateEmail(email);
    const isPhoneValid = validatePhone(phone);

    if (!isEmailValid || !isPhoneValid) {
      return;
    }

    if (!currentOrganizationId) {
      setSubmitError("Organization ID is missing");
      return;
    }

    setIsSubmitting(true);

    try {
      // Reuse the team-member invite flow with the homeowner role. Only the email
      // is sent; the invitee supplies their name and phone when they accept.
      const result = await inviteTeamMember({
        email: email.trim(),
        role: "homeowner",
        organizationId: currentOrganizationId,
        accessToken,
      });

      if (result.success) {
        showToast("Invite sent", {
          description: `Invitation email sent to ${email.trim()}`,
          variant: "email",
        });

        if (onCustomerCreated) {
          onCustomerCreated();
        }
        handleClose();
      } else {
        setSubmitError(result.error || "Failed to send invite");
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
  const isPhoneValid = !phone.trim() || phoneRegex.test(phone);
  const isFormValid =
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    isEmailValid &&
    isPhoneValid &&
    !isSubmitting;

  // Reset form when modal closes
  const handleClose = () => {
    // A deliberate close (or a successful submit, which calls this) drops the saved draft;
    // it only exists to survive a reload.
    customerDraftStore.clear();
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setEmailError("");
    setEmailTouched(false);
    setPhoneError("");
    setPhoneTouched(false);
    setSubmitError("");
    onClose();
  };

  const isDirty =
    firstName.trim() !== "" ||
    lastName.trim() !== "" ||
    email.trim() !== "" ||
    phone.trim() !== "";
  const guard = useDismissGuard({ isOpen, isDirty, isSubmitting, onConfirmClose: handleClose });

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
              Add New Customer
            </h2>
            <p className="text-gray-600">
              Send a sign up link to invite a new customer
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

            {/* Phone Field */}
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Phone Number <span className="text-gray-400">(optional)</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  value={phone}
                  onChange={handlePhoneInput}
                  onBlur={handlePhoneBlur}
                  className={`input-field pl-10 ${
                    phoneError && phoneTouched
                      ? "border-red-500 focus:ring-red-500"
                      : ""
                  }`}
                  placeholder="(555) 123-4567"
                />
              </div>
              {phoneError && phoneTouched && (
                <p className="mt-1 text-sm text-red-600">{phoneError}</p>
              )}
            </div>

            {/* Error Message */}
            {submitError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{submitError}</p>
              </div>
            )}

            {/* Send Button */}
            <button
              type="submit"
              disabled={!isFormValid}
              className="btn-primary w-full flex justify-center items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send sign up link</span>
                </>
              )}
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

