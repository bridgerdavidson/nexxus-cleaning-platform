"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader, ArrowRight, X, Sparkles } from "lucide-react";
import { supabaseUrl, supabaseAnonKey } from "../lib/supabase";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface CleanerProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  accessToken: string | null | undefined;
}

export default function CleanerProfileModal({
  isOpen,
  onClose,
  userId,
  accessToken,
}: CleanerProfileModalProps) {
  const [bio, setBio] = useState("");
  const [experienceYears, setExperienceYears] = useState<number>(0);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  // Note: Tab visibility handling is in LayoutWrapper (global)
  // No need to add it here - would cause multiple listeners

  if (!isOpen) return null;

  const handleComplete = async () => {
    console.log("[CleanerProfileModal] handleComplete START", {
      userId,
      bioLength: bio.length,
      experienceYears,
      hasToken: !!accessToken,
    });

    setError("");
    setIsLoading(true);

    try {
      if (!accessToken) {
        setError("Session missing. Please sign in again.");
        setTimeout(() => router.push("/login"), 1500);
        return;
      }

      const url = `${supabaseUrl}/rest/v1/cleaner_profiles?id=eq.${encodeURIComponent(
        userId
      )}`;

      const payload = {
        bio: bio || null,
        experience_years: experienceYears || null,
        updated_at: new Date().toISOString(),
      };

      console.log("[CleanerProfileModal] sending PATCH via fetch...", {
        url,
        payload,
      });

      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("[CleanerProfileModal] update failed", res.status, text);
        setError(
          `Failed to save profile: ${res.status} ${
            text || res.statusText || ""
          }`
        );
        return;
      }

      const data = await res.json();
      console.log("[CleanerProfileModal] update via fetch resolved", data);

      // Call onClose to let parent handle redirect
      onClose();
    } catch (err) {
      console.error("[CleanerProfileModal] CATCH", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(
        `Could not save profile: ${msg}. If this keeps happening, please refresh and sign in again.`
      );
    } finally {
      console.log("[CleanerProfileModal] FINALLY, clearing loading");
      setIsLoading(false);
    }
  };

  const handleSkip = async () => {
    // Call onClose to let parent handle redirect - user can set up profile later in dashboard
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleSkip}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 animate-slide-up">
          {/* Close button */}
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-success-100 rounded-full mb-4">
              <Sparkles className="w-8 h-8 text-success-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome to the Team!
            </h2>
            <p className="text-gray-600">
              Let&apos;s set up your cleaner profile (optional)
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Form */}
          <div className="space-y-6">
            {/* Bio */}
            <div>
              <label
                htmlFor="bio"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Tell us about yourself
              </label>
              <textarea
                id="bio"
                rows={5}
                maxLength={500}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="input-field resize-none"
                placeholder="Share your experience, specialties, and what makes you a great cleaner..."
              />
              <div className="flex justify-between items-center mt-1">
                <p className="text-xs text-gray-500">
                  Help clients get to know you better
                </p>
                <p className="text-xs text-gray-500">{bio.length}/500</p>
              </div>
            </div>

            {/* Years of Experience */}
            <div>
              <label
                htmlFor="experienceYears"
                className="block text-sm font-medium text-gray-700 mb-3"
              >
                Years of Professional Experience
              </label>
              <div className="space-y-3">
                <input
                  id="experienceYears"
                  type="range"
                  min="0"
                  max="50"
                  value={experienceYears}
                  onChange={(e) => setExperienceYears(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                  style={{
                    background: `linear-gradient(to right, #10b981 0%, #10b981 ${
                      (experienceYears / 50) * 100
                    }%, #e5e7eb ${
                      (experienceYears / 50) * 100
                    }%, #e5e7eb 100%)`,
                  }}
                />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">0 years</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl font-bold text-success-600">
                      {experienceYears}
                    </span>
                    <span className="text-sm text-gray-600">
                      {experienceYears === 1 ? "year" : "years"}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500">50+ years</span>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSkip}
              disabled={isLoading}
              className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Skip for Now
            </button>
            <button
              onClick={handleComplete}
              disabled={isLoading} // ← just this
              className="flex-1 btn-primary flex justify-center items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>Complete Profile</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

          <p className="mt-4 text-center text-xs text-gray-500">
            You can update this information anytime in your dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
