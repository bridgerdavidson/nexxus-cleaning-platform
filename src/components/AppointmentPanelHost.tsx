"use client";

import React, { useMemo, useState } from "react";
import AppointmentSidePanel from "./AppointmentSidePanel";
import CancelConfirmModal from "./CancelConfirmModal";
import CancelWithFeeModal from "./CancelWithFeeModal";
import AddAppointmentModal from "./AddAppointmentModal";
import { AppointmentCardData } from "./AppointmentCard";
import { formatTimeTo12h } from "../lib/formatTime";
import { stripeNewChargeFlowUiEnabled } from "@/lib/stripe/flags";
import { useAuth } from "../hooks/useAuth";
import { useManagerPermissions } from "../hooks/useManagerPermissions";

interface AppointmentPanelHostProps {
  appointments: AppointmentCardData[];
  appointmentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  role: "admin" | "manager" | "cleaner" | "homeowner";
  canEdit?: boolean;
  canApproveDecline?: boolean;
  onCancelAppointment?: (appointmentId: string) => Promise<void>;
  onDeleteAppointment?: (appointmentId: string) => Promise<void>;
  onMarkComplete?: (appointmentId: string) => Promise<void>;
  onRefreshAppointments?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAppointmentUpdated?: (appointmentId: string, updatedData: any) => void;
  /** Triggered when the panel asks to reschedule a rejected appointment. */
  onRescheduleRejected?: (apt: AppointmentCardData) => void;
}

/**
 * Mounts the AppointmentSidePanel along with the modals it triggers
 * (cancel/delete confirmation, "add with prefilled date" for non-rejected
 * reschedule). Rendered once per dashboard page so any tab can open it via
 * useAppointmentPanel.
 */
export default function AppointmentPanelHost({
  appointments,
  appointmentId,
  isOpen,
  onClose,
  role,
  canEdit = true,
  canApproveDecline = false,
  onCancelAppointment,
  onDeleteAppointment,
  onMarkComplete,
  onRefreshAppointments,
  onAppointmentUpdated,
  onRescheduleRejected,
}: AppointmentPanelHostProps) {
  const { currentOrganizationId, currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  // Cancel-with-fee can CAPTURE money, so it's gated like other payment actions: owners/admins
  // always; managers only with can_manage_payments. Others fall back to the legacy soft-cancel.
  const canFeeCancel =
    currentOrgRole === "owner" ||
    currentOrgRole === "admin" ||
    (currentOrgRole === "manager" && !!permissions?.can_manage_payments);
  const newChargeFlow = stripeNewChargeFlowUiEnabled() && canFeeCancel;

  const appointment = useMemo(() => {
    if (!appointmentId) return null;
    return appointments.find((a) => a.id === appointmentId) ?? null;
  }, [appointments, appointmentId]);

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showFeeModal, setShowFeeModal] = useState(false);
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);
  const [preFilledDate, setPreFilledDate] = useState<string | undefined>();
  const [preFilledTime, setPreFilledTime] = useState<string | undefined>();

  const handleCancelFromPanel = (id: string) => {
    setCancellingId(id);
    // New charge flow: cancel-with-fee modal (releases hold / captures policy fee).
    // Legacy: soft-cancel/delete confirmation.
    if (newChargeFlow) {
      setShowFeeModal(true);
    } else {
      setShowCancelModal(true);
    }
    onClose();
  };

  const handleCancelConfirm = async () => {
    if (cancellingId && onCancelAppointment) {
      await onCancelAppointment(cancellingId);
    }
    setShowCancelModal(false);
    setCancellingId(null);
  };

  const handleDeleteConfirm = async () => {
    if (cancellingId && onDeleteAppointment) {
      await onDeleteAppointment(cancellingId);
    }
    setShowCancelModal(false);
    setCancellingId(null);
  };

  const handleMarkCompleteFromPanel = async (id: string) => {
    if (onMarkComplete) await onMarkComplete(id);
    onClose();
  };

  const handleDeleteFromPanel = async (id: string) => {
    if (onDeleteAppointment) await onDeleteAppointment(id);
    onClose();
  };

  const handleRescheduleFromPanel = (apt: AppointmentCardData) => {
    if (apt.cleaner_confirmation_status === "rejected") {
      onClose();
      onRescheduleRejected?.(apt);
    } else {
      onClose();
      setPreFilledDate(apt.scheduled_date);
      setPreFilledTime(apt.scheduled_time?.slice(0, 5));
      setShowAddAppointmentModal(true);
    }
  };

  const cancellingAppointment = appointments.find(
    (a) => a.id === cancellingId,
  );
  const cancelModalInfo = cancellingAppointment
    ? {
        date: (() => {
          const [year, month, day] = cancellingAppointment.scheduled_date
            .split("-")
            .map(Number);
          return new Date(year, month - 1, day).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
        })(),
        time: formatTimeTo12h(cancellingAppointment.scheduled_time),
        homeowner: cancellingAppointment.homeowner
          ? `${cancellingAppointment.homeowner.first_name} ${cancellingAppointment.homeowner.last_name}`
          : "Unknown",
      }
    : undefined;

  const canReschedule =
    canEdit && (role === "admin" || role === "manager");

  return (
    <>
      <AppointmentSidePanel
        isOpen={isOpen && !!appointment}
        onClose={onClose}
        appointment={appointment}
        onCancel={
          canEdit && onCancelAppointment ? handleCancelFromPanel : undefined
        }
        onMarkComplete={
          canEdit && onMarkComplete ? handleMarkCompleteFromPanel : undefined
        }
        onAppointmentUpdated={(updated) => {
          if (onAppointmentUpdated) {
            onAppointmentUpdated(updated.id, updated);
          } else if (onRefreshAppointments) {
            onRefreshAppointments();
          }
        }}
        onDelete={
          canEdit && onDeleteAppointment ? handleDeleteFromPanel : undefined
        }
        onReschedule={canReschedule ? handleRescheduleFromPanel : undefined}
        role={role}
        canEdit={canEdit}
        canApproveDecline={canApproveDecline}
      />
      <CancelConfirmModal
        isOpen={showCancelModal}
        onClose={() => {
          setShowCancelModal(false);
          setCancellingId(null);
        }}
        onCancel={handleCancelConfirm}
        onDelete={handleDeleteConfirm}
        appointmentInfo={cancelModalInfo}
      />
      {currentOrganizationId && cancellingAppointment && (
        <CancelWithFeeModal
          isOpen={showFeeModal}
          appointmentId={cancellingAppointment.id}
          organizationId={currentOrganizationId}
          totalPrice={cancellingAppointment.total_price ?? 0}
          scheduledDate={cancellingAppointment.scheduled_date ?? null}
          scheduledTime={cancellingAppointment.scheduled_time ?? null}
          homeownerName={cancelModalInfo?.homeowner}
          onClose={() => {
            setShowFeeModal(false);
            setCancellingId(null);
          }}
          onDone={() => {
            if (onRefreshAppointments) onRefreshAppointments();
          }}
        />
      )}
      <AddAppointmentModal
        isOpen={showAddAppointmentModal}
        onClose={() => {
          setShowAddAppointmentModal(false);
          setPreFilledDate(undefined);
          setPreFilledTime(undefined);
        }}
        onAppointmentCreated={() => {
          if (onRefreshAppointments) onRefreshAppointments();
        }}
        preFilledDate={preFilledDate}
        preFilledTime={preFilledTime}
      />
    </>
  );
}
