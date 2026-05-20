"use client";

import React, { useState } from "react";
import { CalendarPlus } from "lucide-react";
import RequestAppointmentModal from "./RequestAppointmentModal";

interface RequestAppointmentButtonProps {
  onCreated?: () => void;
  className?: string;
}

export default function RequestAppointmentButton({
  onCreated,
  className,
}: RequestAppointmentButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        }
      >
        <CalendarPlus className="w-4 h-4" />
        Request Appointment
      </button>
      <RequestAppointmentModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          if (onCreated) onCreated();
        }}
      />
    </>
  );
}
