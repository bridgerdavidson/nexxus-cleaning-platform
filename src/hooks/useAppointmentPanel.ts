"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const APPOINTMENT_QUERY_KEY = "appointment";

/**
 * Keeps the open appointment-details panel in the URL (`?appointment=<id>`) so
 * refresh restores the same view, deep-links work, and browser back closes the
 * panel. Mounted at the dashboard-page level; consumed by Overview sections,
 * BookingsPage, and the panel host itself.
 */
export function useAppointmentPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const appointmentId = searchParams.get(APPOINTMENT_QUERY_KEY);
  const isOpen = appointmentId !== null;

  const openAppointment = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const wasOpen = params.get(APPOINTMENT_QUERY_KEY) !== null;
      params.set(APPOINTMENT_QUERY_KEY, id);
      const url = `${pathname}?${params.toString()}`;
      // Push only on the initial open so browser-back closes the panel.
      // Switching between appointments uses replace to avoid history bloat.
      if (wasOpen) {
        router.replace(url, { scroll: false });
      } else {
        router.push(url, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  const closeAppointment = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(APPOINTMENT_QUERY_KEY);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return { appointmentId, isOpen, openAppointment, closeAppointment };
}
