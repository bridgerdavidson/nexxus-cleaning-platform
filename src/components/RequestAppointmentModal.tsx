"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X, Calendar, Home, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
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

  return (
    <div className="fixed inset-0 z-[300] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors z-10"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white px-8 py-6">
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

          <div className="p-8 overflow-y-auto max-h-[calc(90vh-160px)]">
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
                    <Home className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <select
                      value={selectedPropertyId}
                      onChange={(e) => setSelectedPropertyId(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
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
                  <p className="text-xs text-gray-500 mt-2">
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

          <div className="bg-gray-50 px-8 py-4 flex items-center justify-end gap-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Submit request
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
