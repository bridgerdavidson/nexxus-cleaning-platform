"use client";

import React, { useState, useEffect } from "react";
import { X, DollarSign, Search, Calendar, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface Homeowner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface Appointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  property: {
    name: string;
    address: string;
  } | null;
  service_type: {
    name: string;
  } | null;
  checklist?: {
    name: string;
  } | null;
}

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPaymentRecorded: () => void;
}

export default function RecordPaymentModal({
  isOpen,
  onClose,
  onPaymentRecorded,
}: RecordPaymentModalProps) {
  const { currentOrganizationId } = useAuth();

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  // State
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [homeownersLoading, setHomeownersLoading] = useState(false);
  const [homeownerSearch, setHomeownerSearch] = useState("");
  const [selectedHomeowner, setSelectedHomeowner] = useState<Homeowner | null>(
    null,
  );

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);

  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "ach" | "manual">(
    "manual",
  );
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch homeowners
  useEffect(() => {
    if (!isOpen || !currentOrganizationId) return;

    const fetchHomeowners = async () => {
      setHomeownersLoading(true);
      try {
        const { data, error } = await supabase
          .from("user_profiles")
          .select("id, first_name, last_name, email")
          .eq("role", "homeowner")
          .order("first_name");

        if (error) throw error;
        setHomeowners(data || []);
      } catch (err) {
        console.error("Error fetching homeowners:", err);
      } finally {
        setHomeownersLoading(false);
      }
    };

    fetchHomeowners();
  }, [isOpen, currentOrganizationId]);

  // Fetch appointments when homeowner is selected
  useEffect(() => {
    if (!selectedHomeowner?.id || !currentOrganizationId) {
      setAppointments([]);
      return;
    }

    const fetchAppointments = async () => {
      setAppointmentsLoading(true);
      try {
        const { data, error } = await supabase
          .from("appointments")
          .select(
            `
            id,
            scheduled_date,
            scheduled_time,
            property:properties(
              name,
              address
            ),
            service_type:service_types(
              name
            ),
            checklist:checklists(
              name
            )
          `,
          )
          .eq("organization_id", currentOrganizationId)
          .eq("homeowner_id", selectedHomeowner.id)
          .order("scheduled_date", { ascending: false });

        if (error) throw error;

        // Transform the data
        const transformedData = (data || []).map((apt) => ({
          ...apt,
          property: Array.isArray(apt.property)
            ? apt.property[0]
            : apt.property,
          service_type: Array.isArray(apt.service_type)
            ? apt.service_type[0]
            : apt.service_type,
          checklist: Array.isArray(apt.checklist)
            ? apt.checklist[0]
            : apt.checklist,
        }));

        setAppointments(transformedData);
      } catch (err) {
        console.error("Error fetching appointments:", err);
      } finally {
        setAppointmentsLoading(false);
      }
    };

    fetchAppointments();
  }, [selectedHomeowner, currentOrganizationId]);

  // Reset form
  const resetForm = () => {
    setSelectedHomeowner(null);
    setSelectedAppointment(null);
    setAmount("");
    setPaymentMethod("manual");
    setNotes("");
    setReference("");
    setHomeownerSearch("");
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!amount || Number(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!selectedHomeowner) {
      setError("Please select a homeowner");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/payments/record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organization_id: currentOrganizationId,
          homeowner_id: selectedHomeowner.id,
          appointment_id: selectedAppointment?.id || null,
          amount: Number(amount),
          payment_method: paymentMethod,
          payment_type: "revenue",
          notes: notes || null,
          reference: reference || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to record payment");
      }

      onPaymentRecorded();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const filteredHomeowners = homeowners.filter((h) =>
    `${h.first_name} ${h.last_name} ${h.email}`
      .toLowerCase()
      .includes(homeownerSearch.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Record Payment</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Homeowner Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Owner/Client *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Search homeowners..."
                value={homeownerSearch}
                onChange={(e) => setHomeownerSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {homeownersLoading ? (
              <div className="mt-2 flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : homeownerSearch && filteredHomeowners.length > 0 ? (
              <div className="mt-2 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                {filteredHomeowners.map((homeowner) => (
                  <button
                    key={homeowner.id}
                    type="button"
                    onClick={() => {
                      setSelectedHomeowner(homeowner);
                      setHomeownerSearch("");
                      setSelectedAppointment(null);
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                  >
                    <div className="font-medium text-gray-900">
                      {homeowner.first_name} {homeowner.last_name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {homeowner.email}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedHomeowner && (
              <div className="mt-2 px-4 py-3 bg-primary-50 border border-primary-200 rounded-lg">
                <div className="font-medium text-gray-900">
                  {selectedHomeowner.first_name} {selectedHomeowner.last_name}
                </div>
                <div className="text-sm text-gray-500">
                  {selectedHomeowner.email}
                </div>
              </div>
            )}
          </div>

          {/* Appointment Selection (Optional) */}
          {selectedHomeowner && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Booking Link (Optional)
              </label>
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : appointments.length > 0 ? (
                <select
                  value={selectedAppointment?.id || ""}
                  onChange={(e) => {
                    const apt = appointments.find(
                      (a) => a.id === e.target.value,
                    );
                    setSelectedAppointment(apt || null);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">No booking selected</option>
                  {appointments.map((apt) => (
                    <option key={apt.id} value={apt.id}>
                      {apt.scheduled_date} - {apt.property?.name || "Unknown"} -{" "}
                      {apt.service_type?.name
                        ? apt.checklist?.name
                          ? `${apt.service_type.name} (${apt.checklist.name})`
                          : apt.service_type.name
                        : "Service"}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-gray-500 italic">
                  No appointments found for this homeowner
                </div>
              )}
            </div>
          )}

          {/* Amount */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Amount *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <DollarSign className="w-5 h-5 text-gray-400" />
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Method *
            </label>
            <div className="grid grid-cols-3 gap-3">
              {["card", "ach", "manual"].map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() =>
                    setPaymentMethod(method as typeof paymentMethod)
                  }
                  className={`px-4 py-3 rounded-lg font-medium transition-all ${
                    paymentMethod === method
                      ? "bg-primary-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {method === "card"
                    ? "Card"
                    : method === "ach"
                      ? "ACH"
                      : "Manual"}
                </button>
              ))}
            </div>
          </div>

          {/* Reference */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Reference (Optional)
            </label>
            <input
              type="text"
              placeholder="Transaction reference or ID"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              placeholder="Add any additional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Recording...
                </>
              ) : (
                "Record Payment"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
