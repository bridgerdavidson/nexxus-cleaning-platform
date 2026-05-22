"use client";

import React, { useState } from "react";
import { CalendarPlus } from "lucide-react";
import RequestAppointmentModal from "./RequestAppointmentModal";

interface RequestAppointmentButtonProps {
  onCreated?: () => void;
  className?: string;
  label?: string;
}

export default function RequestAppointmentButton({
  onCreated,
  className,
  label = "Request Cleaning",
}: RequestAppointmentButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ touchAction: "manipulation" }}
        className={
          className ??
          "inline-flex items-center gap-2 min-h-11 px-4 py-2.5 bg-primary-600 text-white font-semibold rounded-lg shadow-sm hover:bg-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
        }
      >
        <CalendarPlus className="w-4 h-4" />
        {label}
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
