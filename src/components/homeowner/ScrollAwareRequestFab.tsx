"use client";

import React, { useEffect, useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { motion } from "motion/react";
import RequestAppointmentModal from "../RequestAppointmentModal";

interface ScrollAwareRequestFabProps {
  onCreated?: () => void;
}

export default function ScrollAwareRequestFab({
  onCreated,
}: ScrollAwareRequestFabProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const lastYRef = useRef(0);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastYRef.current;
        if (y <= 0) {
          setCollapsed(false);
        } else if (delta > 6 && y > 80) {
          setCollapsed(true);
        } else if (delta < -6) {
          setCollapsed(false);
        }
        lastYRef.current = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const spring = { type: "spring" as const, stiffness: 320, damping: 28 };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        initial={false}
        animate={{
          paddingLeft: collapsed ? 14 : 20,
          paddingRight: collapsed ? 14 : 20,
        }}
        transition={spring}
        style={{ touchAction: "manipulation" }}
        aria-label="Request Cleaning"
        className="inline-flex items-center py-3.5 bg-primary-600 text-white font-semibold rounded-full shadow-lg hover:bg-primary-700 hover:shadow-xl active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 overflow-hidden"
      >
        <CalendarPlus className="w-5 h-5 shrink-0" />
        <motion.span
          initial={false}
          animate={{
            maxWidth: collapsed ? 0 : 200,
            opacity: collapsed ? 0 : 1,
            marginLeft: collapsed ? 0 : 8,
          }}
          transition={spring}
          className="overflow-hidden whitespace-nowrap"
        >
          Request Cleaning
        </motion.span>
      </motion.button>
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
