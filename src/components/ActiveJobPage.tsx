"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { JobProgress, JobWorkflowState, ChecklistItem } from "../types";
import {
  updateJobProgress,
  useChecklist,
  useJobPhotosForAppointment,
} from "../hooks/useCleanerData";
import JobProgressIndicator from "./JobProgressIndicator";
import NoPhotosWarningModal from "./NoPhotosWarningModal";
import JobPhotoSection from "./JobPhotoSection";

interface ActiveJobPageProps {
  appointmentId: string;
  onExit: () => void;
  onComplete: () => Promise<void>;
}

export default function ActiveJobPage({
  appointmentId,
  onExit,
  onComplete,
}: ActiveJobPageProps) {
  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState<JobProgress>("before_photos");
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [photoWarningType, setPhotoWarningType] = useState<"before" | "after">(
    "before",
  );
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  // Appointment data
  const [appointment, setAppointment] = useState<{
    homeowner: { first_name: string; last_name: string } | null;
    service_type: { name: string; id: string } | null;
    checklist_id: string | null;
    job_progress: JobProgress;
  } | null>(null);

  // Job photos from DB — source of truth for hasBeforePhotos / hasAfterPhotos
  const {
    beforePhotos,
    afterPhotos,
    refetch: refetchPhotos,
  } = useJobPhotosForAppointment(appointmentId);

  const hasBeforePhotos = beforePhotos.length > 0;
  const hasAfterPhotos = afterPhotos.length > 0;

  // Fetch checklist for this appointment (prefers saved checklist_id)
  const {
    checklist,
    lineItems,
    loading: checklistLoading,
  } = useChecklist({
    checklistId: appointment?.checklist_id ?? null,
    serviceTypeId: appointment?.service_type?.id ?? null,
  });

  // Session storage key
  const storageKey = `job_workflow_${appointmentId}`;

  // Load appointment and workflow state
  useEffect(() => {
    const loadAppointment = async () => {
      try {
        setLoading(true);

        // Fetch appointment with relations
        const { data, error } = await supabase
          .from("appointments")
          .select(
            `
            id,
            checklist_id,
            job_progress,
            homeowner:user_profiles!homeowner_id(
              first_name,
              last_name
            ),
            service_type:service_types(
              id,
              name
            )
          `,
          )
          .eq("id", appointmentId)
          .single();

        if (error) throw error;

        const appointmentData = {
          homeowner: Array.isArray(data.homeowner)
            ? data.homeowner[0]
            : data.homeowner,
          service_type: Array.isArray(data.service_type)
            ? data.service_type[0]
            : data.service_type,
          checklist_id: data.checklist_id ?? null,
          job_progress: data.job_progress as JobProgress,
        };

        setAppointment(appointmentData);

        // Load from session storage if exists (step + checklist only; photos come from DB)
        const savedState = sessionStorage.getItem(storageKey);
        if (savedState) {
          try {
            const state: JobWorkflowState = JSON.parse(savedState);
            setCurrentStep(state.step);
            setChecklistItems(state.checklistProgress);
          } catch {
            // If parse fails, use DB state
            setCurrentStep(appointmentData.job_progress);
          }
        } else {
          setCurrentStep(appointmentData.job_progress);
        }
      } catch (error) {
        console.error("Error loading appointment:", error);
      } finally {
        setLoading(false);
      }
    };

    loadAppointment();
  }, [appointmentId, storageKey]);

  // Auto-fix job_progress if stuck on not_started
  useEffect(() => {
    const autoFixProgress = async () => {
      if (currentStep === "not_started" && !loading) {
        console.log(
          "Auto-fixing job_progress from not_started to before_photos",
        );
        const result = await updateJobProgress(appointmentId, "before_photos");
        if (result.success) {
          setCurrentStep("before_photos");
        }
      }
    };

    autoFixProgress();
  }, [currentStep, loading, appointmentId]);

  // Align checklist UI with loaded line items; merge completion from session when IDs match
  useEffect(() => {
    if (checklistLoading) return;

    if (lineItems.length === 0) {
      // Avoid producing a new [] reference when state is already empty —
      // setting fresh [] each render would loop the effect via lineItems
      // recomputation in the upstream hook.
      setChecklistItems((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    setChecklistItems((prev) => {
      const lineIds = new Set(lineItems.map((l) => l.id));
      const sameShape =
        prev.length === lineItems.length &&
        prev.every((p) => lineIds.has(p.id));

      if (sameShape) {
        const next = lineItems.map((item) => {
          const old = prev.find((p) => p.id === item.id)!;
          return {
            id: item.id,
            task: item.task,
            completed: old.completed,
          };
        });
        const identical =
          next.length === prev.length &&
          next.every(
            (n, i) =>
              n.id === prev[i].id &&
              n.task === prev[i].task &&
              n.completed === prev[i].completed,
          );
        return identical ? prev : next;
      }

      let sessionProgress: ChecklistItem[] = [];
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const state: JobWorkflowState = JSON.parse(raw);
          sessionProgress = state.checklistProgress || [];
        }
      } catch {
        // ignore invalid session
      }

      const completedById = new Map(
        sessionProgress.map((p) => [p.id, p.completed]),
      );

      return lineItems.map((item) => ({
        id: item.id,
        task: item.task,
        completed: completedById.get(item.id) ?? false,
      }));
    });
  }, [lineItems, checklistLoading, storageKey]);

  // Save step + checklist state to session storage
  // hasBeforePhotos / hasAfterPhotos are sourced from DB, not session storage
  const saveToSessionStorage = useCallback(() => {
    const state: JobWorkflowState = {
      step: currentStep,
      checklistProgress: checklistItems,
      hasBeforePhotos,
      hasAfterPhotos,
      lastUpdated: new Date().toISOString(),
    };
    sessionStorage.setItem(storageKey, JSON.stringify(state));
  }, [
    currentStep,
    checklistItems,
    hasBeforePhotos,
    hasAfterPhotos,
    storageKey,
  ]);

  // Auto-save to session storage when step or checklist changes
  useEffect(() => {
    if (!loading) {
      saveToSessionStorage();
    }
  }, [currentStep, checklistItems, loading, saveToSessionStorage]);

  // Toggle checklist item
  const toggleChecklistItem = (itemId: string) => {
    setChecklistItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, completed: !item.completed } : item,
      ),
    );
  };

  // Check if can proceed to next step
  const canProceed = () => {
    if (currentStep === "checklist") {
      return checklistItems.every((item) => item.completed);
    }
    return true;
  };

  // Handle next step
  const handleNext = async () => {
    // Check for photo warnings (treat not_started same as before_photos)
    if (
      (currentStep === "before_photos" || currentStep === "not_started") &&
      !hasBeforePhotos
    ) {
      setPhotoWarningType("before");
      setShowWarningModal(true);
      return;
    }

    if (currentStep === "after_photos" && !hasAfterPhotos) {
      setPhotoWarningType("after");
      setShowWarningModal(true);
      return;
    }

    await proceedToNext();
  };

  // Proceed to next step (after warning confirmation if needed) or complete job from modal
  const proceedToNext = async () => {
    setSaving(true);
    try {
      let nextStep: JobProgress = currentStep;

      // Treat not_started same as before_photos
      if (currentStep === "before_photos" || currentStep === "not_started") {
        nextStep = "checklist";
      } else if (currentStep === "checklist") {
        nextStep = "after_photos";
      }

      // Update database
      const result = await updateJobProgress(appointmentId, nextStep);
      if (!result.success) {
        throw new Error(result.error);
      }

      setCurrentStep(nextStep);
      setShowWarningModal(false);
    } catch (error) {
      console.error("Error proceeding to next step:", error);
      alert("Failed to proceed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Handle back
  const handleBack = async () => {
    setSaving(true);
    try {
      let prevStep: JobProgress = currentStep;

      if (currentStep === "checklist") {
        prevStep = "before_photos"; // Go back to before_photos (not not_started)
      } else if (currentStep === "after_photos") {
        prevStep = "checklist";
      }

      // Update database
      const result = await updateJobProgress(appointmentId, prevStep);
      if (!result.success) {
        throw new Error(result.error);
      }

      setCurrentStep(prevStep);
    } catch (error) {
      console.error("Error going back:", error);
      alert("Failed to go back. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Actual job completion (called after warning confirmation or when photos exist)
  const confirmCompleteJob = async () => {
    setSaving(true);
    try {
      setShowWarningModal(false);
      // Clear session storage
      sessionStorage.removeItem(storageKey);

      // Complete the job (this will update status to completed)
      await onComplete();
    } catch (error) {
      console.error("Error completing job:", error);
      alert("Failed to complete job. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Handle complete job click - show warning if no after photos
  const handleCompleteJobClick = () => {
    if (!hasAfterPhotos) {
      setPhotoWarningType("after");
      setShowWarningModal(true);
      return;
    }
    confirmCompleteJob();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">Failed to load appointment</p>
      </div>
    );
  }

  const serviceName = appointment.service_type?.name
    ? checklist?.name
      ? `${appointment.service_type.name} (${checklist.name})`
      : appointment.service_type.name
    : "Service";

  return (
    <div className="space-y-6">
      {/* Progress indicator - its own transparent container above content */}
      <div className="flex justify-center w-full py-2">
        <JobProgressIndicator currentProgress={currentStep} size="md" />
      </div>

      {/* Content container: Upload Before Photos / Checklist / After Photos */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        {/* Step 1: Before Photos (also handles not_started state) */}
        {(currentStep === "before_photos" || currentStep === "not_started") && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Before Photos
              </h2>
              <p className="text-gray-600 mt-1">
                Document the property condition before starting the cleaning
                job.
              </p>
            </div>
            <JobPhotoSection
              appointmentId={appointmentId}
              photoType="before"
              photos={beforePhotos}
              onPhotosChange={refetchPhotos}
              onUploadingChange={setIsPhotoUploading}
            />
          </div>
        )}

        {/* Step 2: Checklist */}
        {currentStep === "checklist" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold text-gray-900">
                  Cleaning Checklist
                </h2>
                {serviceName !== "Service" && (
                  <p
                    className="text-sm text-gray-600 mt-1 truncate"
                    title={serviceName}
                  >
                    {serviceName}
                  </p>
                )}
              </div>
              <span className="text-sm font-medium text-gray-600 flex-shrink-0">
                {checklistItems.filter((item) => item.completed).length} of{" "}
                {checklistItems.length} tasks completed
              </span>
            </div>
            <p className="text-gray-600">
              Complete all tasks before moving to the next step.
            </p>

            {checklistLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            ) : checklistItems.length > 0 ? (
              <div className="space-y-2">
                {checklistItems.map((item) => (
                  <label
                    key={item.id}
                    className={`flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      item.completed
                        ? "bg-gray-50 border-gray-200"
                        : "bg-white border-gray-200 hover:border-primary-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => toggleChecklistItem(item.id)}
                      className="mt-1 w-5 h-5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span
                      className={`flex-1 ${
                        item.completed
                          ? "line-through text-gray-400"
                          : "text-gray-900"
                      }`}
                    >
                      {item.task}
                    </span>
                    {item.completed && (
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                    )}
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p>No checklist items found for this service type.</p>
                <p className="text-sm mt-2">
                  You can proceed to the next step.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: After Photos */}
        {currentStep === "after_photos" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">After Photos</h2>
              <p className="text-gray-600 mt-1">
                Document the property after completing the cleaning job.
              </p>
            </div>
            <JobPhotoSection
              appointmentId={appointmentId}
              photoType="after"
              photos={afterPhotos}
              onPhotosChange={refetchPhotos}
              onUploadingChange={setIsPhotoUploading}
            />
          </div>
        )}
      </div>

      {/* Action Buttons - at bottom, no box */}
      <div className="flex items-center justify-between gap-3 pt-2">
        {/* Back button */}
        {(currentStep === "checklist" || currentStep === "after_photos") && (
          <button
            onClick={handleBack}
            disabled={saving}
            className="px-4 py-2.5 text-gray-700 font-medium rounded-lg border-2 border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Spacer when no back button */}
        {currentStep === "before_photos" && <div />}

        {/* Next/Complete button */}
        {currentStep !== "after_photos" ? (
          <button
            onClick={handleNext}
            disabled={!canProceed() || saving || isPhotoUploading}
            title={
              isPhotoUploading
                ? "Wait for photos to finish uploading"
                : undefined
            }
            className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : isPhotoUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading photos…
              </>
            ) : (
              <>
                Next Step
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleCompleteJobClick}
            disabled={saving || isPhotoUploading}
            title={
              isPhotoUploading
                ? "Wait for photos to finish uploading"
                : undefined
            }
            className="flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Completing...
              </>
            ) : isPhotoUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading photos…
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Complete Job
              </>
            )}
          </button>
        )}
      </div>

      {/* Warning Modal - onContinue: confirmCompleteJob when completing without after photos, proceedToNext otherwise */}
      <NoPhotosWarningModal
        isOpen={showWarningModal}
        onClose={() => setShowWarningModal(false)}
        onContinue={
          photoWarningType === "after" ? confirmCompleteJob : proceedToNext
        }
        photoType={photoWarningType}
      />
    </div>
  );
}
