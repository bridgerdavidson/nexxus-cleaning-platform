"use client";

import React, { useState } from "react";
import { CalendarPlus } from "lucide-react";
import RequestAppointmentModal from "../RequestAppointmentModal";
import ScrollAwareFab from "../ScrollAwareFab";

interface ScrollAwareRequestFabProps {
  onCreated?: () => void;
}

export default function ScrollAwareRequestFab({
  onCreated,
}: ScrollAwareRequestFabProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ScrollAwareFab
        label="Request Cleaning"
        icon={CalendarPlus}
        onClick={() => setOpen(true)}
        ariaLabel="Request Cleaning"
      />
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
