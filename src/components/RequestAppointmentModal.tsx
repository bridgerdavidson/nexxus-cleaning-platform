"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, Home, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { formatDateTimeTo12h } from "../lib/formatTime";
import SlotPicker, { type SlotInput } from "./appointments/SlotPicker";

interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
}

interface ServiceType {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
}

interface RequestAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const getTodayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function RequestAppointmentModal({
  isOpen,
  onClose,
  onCreated,
}: RequestAppointmentModalProps) {
  const { user, currentOrganizationId, accessToken } = useAuth();
  const homeownerId = user?.id ?? "";
  const orgId = currentOrganizationId ?? "";

  useBodyScrollLock(isOpen);
  useEscapeClose(isOpen, onClose);

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");

  const [services, setServices] = useState<ServiceType[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");

  const [slots, setSlots] = useState<SlotInput[]>([{ date: "", time: "" }]);
  const [specialRequests, setSpecialRequests] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default property to most-recently-booked
  const fetchProperties = useCallback(async () => {
    if (!homeownerId || !orgId) return;
    setPropertiesLoading(true);
    try {
      const { data, error: propsErr } = await supabase
        .from("properties")
        .select("id, name, address, city, state, zip_code")
        .eq("owner_id", homeownerId)
        .order("created_at", { ascending: false });
      if (propsErr) throw propsErr;
      const ps = (data ?? []) as Property[];
      setProperties(ps);

      const { data: lastApt } = await supabase
        .from("appointments")
        .select("property_id, created_at")
        .eq("homeowner_id", homeownerId)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1);
      const mostRecent = lastApt?.[0]?.property_id as string | undefined;
      setSelectedPropertyId(
        ps.find((p) => p.id === mostRecent)?.id ?? ps[0]?.id ?? "",
      );
    } catch (err) {
      console.error("Error loading properties:", err);
      setError("Failed to load your properties.");
    } finally {
      setPropertiesLoading(false);
    }
  }, [homeownerId, orgId]);

  const fetchServices = useCallback(async () => {
    if (!orgId) return;
    setServicesLoading(true);
    try {
      const { data, error: svcErr } = await supabase
        .from("service_types")
        .select("id, name, description, base_price, duration_minutes")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (svcErr) throw svcErr;
      const list = (data ?? []) as ServiceType[];
      setServices(list);
      setSelectedServiceId(list[0]?.id ?? "");
    } catch (err) {
      console.error("Error loading services:", err);
      setError("Failed to load services.");
    } finally {
      setServicesLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!isOpen) return;
    fetchProperties();
    fetchServices();
  }, [isOpen, fetchProperties, fetchServices]);

  useEffect(() => {
    if (!isOpen) {
      // Reset on close
      setSlots([{ date: "", time: "" }]);
      setSpecialRequests("");
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  const today = getTodayLocal();
  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  const isValid =
    !!selectedPropertyId &&
    !!selectedServiceId &&
    slots.length >= 1 &&
    slots.every((s) => !!s.date && !!s.time);

  const handleSubmit = async () => {
    if (!isValid || !accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/appointments/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          organizationId: orgId,
          propertyId: selectedPropertyId,
          serviceTypeId: selectedServiceId,
          slots: slots.map((s) => ({ scheduled_date: s.date, scheduled_time: s.time })),
          specialRequests: specialRequests.trim() || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to submit request");
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        className="relative w-full flex flex-col bg-white min-h-dvh overflow-hidden animate-sheet-up sm:animate-slide-up sm:m-auto sm:max-w-2xl sm:min-h-0 sm:max-h-[90vh] sm:rounded-2xl sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 relative bg-gradient-to-r from-primary-600 to-primary-700 text-white px-6 sm:px-8 pt-[max(env(safe-area-inset-top),1.25rem)] pb-5">
          <button
            onClick={onClose}
            className="absolute top-[max(env(safe-area-inset-top),0.75rem)] right-3 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center justify-center mb-3">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-white/20 rounded-full">
              <Calendar className="w-6 h-6" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center mb-1">Request Appointment</h2>
          <p className="text-primary-100 text-center text-sm">
            Offer up to 3 preferred times. We&apos;ll match you with a cleaner.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Property</label>
              {propertiesLoading ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading your properties…
                </div>
              ) : properties.length === 0 ? (
                <p className="text-sm text-gray-500">
                  You don&apos;t have any properties yet. Add one from your profile first.
                </p>
              ) : (
                <div className="relative">
                  <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <select
                    value={selectedPropertyId}
                    onChange={(e) => setSelectedPropertyId(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.address}, {p.city}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Service</label>
              {servicesLoading ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading services…
                </div>
              ) : (
                <>
                  <select
                    value={selectedServiceId}
                    onChange={(e) => setSelectedServiceId(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — ${s.base_price} · {s.duration_minutes} min
                      </option>
                    ))}
                  </select>
                  {selectedService?.description && (
                    <p className="text-xs text-gray-500 mt-1">{selectedService.description}</p>
                  )}
                </>
              )}
            </div>

            <div>
              <SlotPicker slots={slots} onChange={setSlots} minDate={today} />
              {slots[0]?.date && slots[0]?.time && (
                <p className="text-xs text-gray-500 mt-3">
                  First preference: {formatDateTimeTo12h(slots[0].date, slots[0].time)}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes for your cleaner (optional)
              </label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Anything specific they should know?"
              />
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 sm:px-8 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-3 sm:py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="w-full sm:w-auto px-5 py-3 sm:py-2 bg-primary-600 text-white rounded-lg font-semibold shadow-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Submit request
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
