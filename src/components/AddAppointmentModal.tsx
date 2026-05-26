"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Calendar,
  Search,
  Plus,
  User,
  Home,
  CheckCircle,
  Circle,
  ChevronDown,
  ChevronLeft,
  Ban,
  Loader2,
  Repeat,
  CreditCard,
  DollarSign,
  AlertTriangle,
} from "lucide-react";
import type { RecurrenceType } from "../types";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { computeResponseDeadlineISO } from "../lib/computeResponseDeadline";
import type { ScheduleAppointment } from "../lib/appointmentConflicts";
import { rankCleanersByAvailability } from "../lib/cleanerAvailability";
import { formatTimeTo12h } from "../lib/formatTime";
import PaymentMethodForm from "./PaymentMethodForm";
import SlotPicker, { type SlotInput } from "./appointments/SlotPicker";
import AppointmentPaymentSection, { DEFER_CARD } from "./AppointmentPaymentSection";
import { getAccessToken } from "@/lib/auth/clientAccessToken";

interface Homeowner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  owner_id: string;
}

interface ServiceType {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
}

interface ChecklistOption {
  id: string;
  name: string;
  service_type_id: string;
  price_adder: number;
}

interface Cleaner {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  } | null;
}

interface AddAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAppointmentCreated: () => void;
  preSelectedHomeownerId?: string;
  preSelectedPropertyId?: string;
  preFilledDate?: string; // YYYY-MM-DD format
  preFilledTime?: string; // HH:mm format
  hidePriceOverride?: boolean; // Hide price override UI for homeowner role
}

export default function AddAppointmentModal({
  isOpen,
  onClose,
  onAppointmentCreated,
  preSelectedHomeownerId,
  preSelectedPropertyId,
  preFilledDate,
  preFilledTime,
  hidePriceOverride = false,
}: AddAppointmentModalProps) {
  const { currentOrganizationId } = useAuth();

  // Appointments requiring cleaner availability confirmation should always start pending.
  const initialStatus = "pending";

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  const overlayScrollRef = useRef<HTMLDivElement>(null);
  const modalBodyScrollRef = useRef<HTMLDivElement>(null);

  // Step management - always start at step 1
  // When homeowner only is pre-selected: step 1 = select property, step 2 = appointment details, step 3 = cleaner
  // When homeowner and property are pre-selected: step 1 = appointment details, step 2 = cleaner
  // When not pre-selected: step 1 = homeowner/property, step 2 = appointment details, step 3 = cleaner
  const [currentStep, setCurrentStep] = useState(1);

  // On mobile, Step 1's combined homeowner+property picker is split into two sub-screens.
  // Desktop ignores this state (both panels render via sm:block).
  const [mobileSubStep, setMobileSubStep] = useState<"homeowner" | "property">(
    "homeowner",
  );

  // Step changes reuse the same scroll containers; reset so each step starts at the top
  useEffect(() => {
    if (!isOpen) return;
    overlayScrollRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "instant",
    });
    modalBodyScrollRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "instant",
    });
  }, [currentStep, isOpen]);

  // Step 1 state
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [homeownersLoading, setHomeownersLoading] = useState(false);
  const [homeownerSearch, setHomeownerSearch] = useState("");
  const [selectedHomeowner, setSelectedHomeowner] = useState<Homeowner | null>(
    null,
  );

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(
    null,
  );

  // Step 2 state
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [serviceTypesLoading, setServiceTypesLoading] = useState(false);
  const [selectedServiceType, setSelectedServiceType] =
    useState<ServiceType | null>(null);
  const [checklists, setChecklists] = useState<ChecklistOption[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(false);
  const [selectedChecklist, setSelectedChecklist] =
    useState<ChecklistOption | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [alternateSlots, setAlternateSlots] = useState<SlotInput[]>([]);
  const [specialRequests, setSpecialRequests] = useState("");
  // New charge flow: selected card (a pm id), 'send-link', DEFER_CARD, or null. Only a real
  // pm id triggers an authorization hold on save.
  const [paymentSelection, setPaymentSelection] = useState<string | null>(null);

  // Recurrence state
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [selectedDaysOfWeek, setSelectedDaysOfWeek] = useState<number[]>([]);
  const [recurrenceEndType, setRecurrenceEndType] = useState<
    "date" | "occurrences"
  >("date");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [recurrenceMaxOccurrences, setRecurrenceMaxOccurrences] = useState(10);

  // Step 3 state
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [cleanersLoading, setCleanersLoading] = useState(false);
  const [cleanerSearch, setCleanerSearch] = useState("");
  const [selectedCleaner, setSelectedCleaner] = useState<Cleaner | null>(null);
  // Which unavailable cleaner card is currently expanded (collapse-on-default).
  const [expandedCleanerId, setExpandedCleanerId] = useState<string | null>(null);

  // Org-wide map of cleaner_id → that cleaner's active appointments on the
  // currently-selected `scheduledDate`. Loaded once per date change so the
  // unified-step UI can render every cleaner's availability without per-pick
  // round-trips.
  const [cleanerSchedulesByCleaner, setCleanerSchedulesByCleaner] = useState<
    Record<string, ScheduleAppointment[]>
  >({});

  // Step 2 - Price override state
  const [customPrice, setCustomPrice] = useState<string>("");
  const [priceOverrideEnabled, setPriceOverrideEnabled] = useState(false);

  // Step 4 - Payment method state
  const [paymentMethodSaved, setPaymentMethodSaved] = useState(false);
  const [skipPaymentMethod, setSkipPaymentMethod] = useState(false);

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getSystemCalculatedPrice = useCallback(() => {
    if (!selectedServiceType || !selectedChecklist) return 0;
    return (
      selectedServiceType.base_price + (selectedChecklist.price_adder || 0)
    );
  }, [selectedChecklist, selectedServiceType]);

  // Fetch and set pre-selected homeowner
  const fetchPreSelectedHomeowner = async () => {
    if (!preSelectedHomeownerId || !currentOrganizationId) return;

    try {
      // Fetch homeowner
      const { data: homeownerData, error: homeownerError } = await supabase
        .from("user_profiles")
        .select("id, first_name, last_name, email")
        .eq("id", preSelectedHomeownerId)
        .single();

      if (homeownerError) throw homeownerError;

      if (homeownerData) {
        const homeowner: Homeowner = {
          id: homeownerData.id,
          first_name: homeownerData.first_name,
          last_name: homeownerData.last_name,
          email: homeownerData.email,
        };
        setSelectedHomeowner(homeowner);

        // If property is also pre-selected, fetch it
        if (preSelectedPropertyId) {
          const { data: propertyData, error: propertyError } = await supabase
            .from("properties")
            .select("*")
            .eq("id", preSelectedPropertyId)
            .single();

          if (propertyError) throw propertyError;

          if (propertyData) {
            const property: Property = {
              id: propertyData.id,
              name: propertyData.name,
              address: propertyData.address,
              city: propertyData.city,
              state: propertyData.state,
              zip_code: propertyData.zip_code,
              owner_id: propertyData.owner_id,
            };
            setSelectedProperty(property);
          }
        } else {
          // If only homeowner is pre-selected, fetch their properties for step 1
          fetchProperties(preSelectedHomeownerId);
        }
      }
    } catch (err) {
      console.error("Error fetching pre-selected homeowner:", err);
      setError("Failed to load homeowner information");
    }
  };

  // Fetch homeowners on modal open
  useEffect(() => {
    if (isOpen && currentOrganizationId) {
      fetchServiceTypes();
      fetchCleaners();

      // If homeowner is pre-selected, fetch homeowner (and property if also pre-selected)
      if (preSelectedHomeownerId) {
        fetchPreSelectedHomeowner();
      } else {
        // Otherwise, fetch all homeowners
        fetchHomeowners();
      }

      // Pre-fill date and time if provided (from calendar quick-add)
      if (preFilledDate) {
        setScheduledDate(preFilledDate);
      }
      if (preFilledTime) {
        setScheduledTime(preFilledTime);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    currentOrganizationId,
    preSelectedHomeownerId,
    preSelectedPropertyId,
    preFilledDate,
    preFilledTime,
  ]);

  // Fetch properties when homeowner is selected (only when not pre-selected)
  useEffect(() => {
    if (selectedHomeowner && !preSelectedHomeownerId) {
      fetchProperties(selectedHomeowner.id);
    } else if (!selectedHomeowner && !preSelectedHomeownerId) {
      // Clear properties if homeowner is deselected
      setProperties([]);
      setSelectedProperty(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHomeowner, preSelectedHomeownerId]);

  const fetchHomeowners = async () => {
    if (!currentOrganizationId) return;

    try {
      setHomeownersLoading(true);

      // Get all users in this organization with homeowner role
      // This now works directly thanks to the RLS policies for organization_members
      const { data: members, error: membersError } = await supabase
        .from("organization_members")
        .select(
          `
          user_id,
          user_profiles!inner(
            id,
            first_name,
            last_name,
            email
          )
        `,
        )
        .eq("organization_id", currentOrganizationId)
        .eq("role", "homeowner");

      if (membersError) throw membersError;

      // Transform the data to flatten it
      const homeownersData = (members || [])
        .map((member) => {
          const profile = Array.isArray(member.user_profiles)
            ? member.user_profiles[0]
            : member.user_profiles;
          return {
            id: profile.id,
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
          };
        })
        .sort((a, b) => a.first_name.localeCompare(b.first_name));

      setHomeowners(homeownersData);
    } catch (err) {
      console.error("Error fetching homeowners:", err);
      setError("Failed to load homeowners");
    } finally {
      setHomeownersLoading(false);
    }
  };

  const fetchProperties = async (ownerId: string) => {
    if (!currentOrganizationId) return;

    try {
      setPropertiesLoading(true);
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setProperties(data || []);
    } catch (err) {
      console.error("Error fetching properties:", err);
      setError("Failed to load properties");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const fetchServiceTypes = async () => {
    if (!currentOrganizationId) return;

    try {
      setServiceTypesLoading(true);
      const { data, error } = await supabase
        .from("service_types")
        .select("id, name, description, base_price, duration_minutes")
        .eq("is_active", true)
        .eq("organization_id", currentOrganizationId)
        .order("name", { ascending: true });

      if (error) throw error;
      setServiceTypes(data || []);
    } catch (err) {
      console.error("Error fetching service types:", err);
      setError("Failed to load service types");
    } finally {
      setServiceTypesLoading(false);
    }
  };

  const fetchChecklists = useCallback(
    async (serviceTypeId: string) => {
      if (!currentOrganizationId) return;

      try {
        setChecklistsLoading(true);
        setChecklists([]);
        const { data, error } = await supabase
          .from("checklists")
          .select("id, name, service_type_id, price_adder")
          .eq("service_type_id", serviceTypeId)
          .order("name", { ascending: true });

        if (error) throw error;

        const checklistOptions = (data || []) as ChecklistOption[];
        setChecklists(checklistOptions);

        if (checklistOptions.length > 0) {
          setSelectedChecklist(checklistOptions[0]);
          if (priceOverrideEnabled) {
            const selectedService = serviceTypes.find(
              (s) => s.id === serviceTypeId,
            );
            if (selectedService) {
              const systemTotal =
                selectedService.base_price +
                (checklistOptions[0].price_adder || 0);
              setCustomPrice(systemTotal.toString());
            }
          }
        } else {
          setSelectedChecklist(null);
        }
      } catch (err) {
        console.error("Error fetching checklists:", err);
        setChecklists([]);
        setSelectedChecklist(null);
        setError("Failed to load checklists for this service type");
      } finally {
        setChecklistsLoading(false);
      }
    },
    [currentOrganizationId, priceOverrideEnabled, serviceTypes],
  );

  useEffect(() => {
    if (!selectedServiceType) {
      setChecklists([]);
      setSelectedChecklist(null);
      return;
    }

    fetchChecklists(selectedServiceType.id);
  }, [fetchChecklists, selectedServiceType]);

  const fetchCleaners = async () => {
    if (!currentOrganizationId) return;

    try {
      setCleanersLoading(true);
      const { data, error } = await supabase
        .from("cleaner_profiles")
        .select(
          `
          id,
          user_profile:user_profiles!id(
            first_name,
            last_name,
            avatar_url
          )
        `,
        )
        .eq("organization_id", currentOrganizationId)
        .eq("is_available", true)
        .order("id", { ascending: true });

      if (error) throw error;

      // Transform the data to handle array responses
      const transformedData = (data || []).map((cleaner) => ({
        ...cleaner,
        user_profile: Array.isArray(cleaner.user_profile)
          ? cleaner.user_profile[0]
          : cleaner.user_profile,
      }));

      setCleaners(transformedData);
    } catch (err) {
      console.error("Error fetching cleaners:", err);
      setError("Failed to load cleaners");
    } finally {
      setCleanersLoading(false);
    }
  };

  // Fetch every active appointment on the chosen date across the org, grouped
  // by cleaner_id. Same-day scope is fine because findConflicts is same-day.
  // Re-runs whenever the admin changes the scheduled date.
  useEffect(() => {
    if (!scheduledDate || !currentOrganizationId) {
      setCleanerSchedulesByCleaner({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await supabase
        .from("appointments")
        .select(
          "id, cleaner_id, status, scheduled_date, scheduled_time, duration_minutes",
        )
        .eq("organization_id", currentOrganizationId)
        .eq("scheduled_date", scheduledDate)
        .in("status", ["pending", "confirmed", "in_progress"]);
      if (cancelled) return;
      if (fetchError) {
        console.warn("Schedule fetch failed:", fetchError.message);
        setCleanerSchedulesByCleaner({});
        return;
      }
      const grouped: Record<string, ScheduleAppointment[]> = {};
      for (const row of (data || []) as Array<
        ScheduleAppointment & { cleaner_id: string | null }
      >) {
        if (!row.cleaner_id) continue;
        const list = grouped[row.cleaner_id] ?? [];
        list.push(row);
        grouped[row.cleaner_id] = list;
      }
      setCleanerSchedulesByCleaner(grouped);
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduledDate, currentOrganizationId]);

  // Candidate slot for availability checks. Null when date/time/service is
  // incomplete (helper then treats every cleaner as neutral/available).
  const candidateSlot = useMemo(() => {
    if (!scheduledDate || !scheduledTime || !selectedServiceType) return null;
    return {
      date: scheduledDate,
      time: scheduledTime,
      durationMinutes: selectedServiceType.duration_minutes,
    };
  }, [scheduledDate, scheduledTime, selectedServiceType]);

  // Per-cleaner availability ranking. Drives both the Available / Not available
  // groups in the cleaner picker and the override-label flip on the submit
  // button.
  const rankedCleaners = useMemo(
    () => rankCleanersByAvailability(cleaners, cleanerSchedulesByCleaner, candidateSlot),
    [cleaners, cleanerSchedulesByCleaner, candidateSlot],
  );

  // Conflicts attached to the currently-selected cleaner (drives the submit
  // button label flip). Empty when none selected or no candidate.
  const selectedCleanerEntry = rankedCleaners.find(
    (r) => r.cleaner.id === selectedCleaner?.id,
  );
  const hasConflicts = !!selectedCleanerEntry && !selectedCleanerEntry.isAvailable;

  const handleCreateAppointment = async () => {
    if (
      !selectedHomeowner ||
      !selectedProperty ||
      !selectedServiceType ||
      !selectedChecklist ||
      !scheduledDate ||
      !scheduledTime ||
      !currentOrganizationId
    ) {
      setError("Please fill in all required fields");
      return;
    }

    if (!selectedCleaner) {
      setError("Please select a cleaner");
      return;
    }

    // Validate that the appointment is not in the past
    // Allow today's date, but ensure the time is in the future
    const appointmentDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
    const now = new Date();

    // Get today's date string in local timezone for comparison
    const todayLocalStr = getTodayLocal();

    // Allow appointments today as long as the time is in the future
    // Compare date strings directly to avoid timezone issues
    if (scheduledDate < todayLocalStr) {
      setError(
        "Cannot create appointments in the past. Please select today or a future date.",
      );
      return;
    }

    // If the appointment is today, ensure the time is in the future
    if (scheduledDate === todayLocalStr && appointmentDateTime <= now) {
      setError("Please select a future time for today's appointment.");
      return;
    }

    // Validate recurrence end settings
    if (recurrenceType !== "none") {
      if (recurrenceEndType === "date" && !recurrenceEndDate) {
        setError("Please select an end date for the recurring appointments.");
        return;
      }
      if (
        recurrenceEndType === "occurrences" &&
        (!recurrenceMaxOccurrences || recurrenceMaxOccurrences < 1)
      ) {
        setError("Please enter a valid number of occurrences.");
        return;
      }
      if (recurrenceType === "weekly" && selectedDaysOfWeek.length === 0) {
        setError(
          "Please select at least one day of the week for weekly recurrence.",
        );
        return;
      }
    }

    try {
      setIsCreating(true);
      setError(null);

      // Calculate final price (override or base+checklist adder)
      const systemCalculatedPrice = getSystemCalculatedPrice();
      const finalPrice =
        priceOverrideEnabled && customPrice
          ? parseFloat(customPrice)
          : systemCalculatedPrice;

      // Only a concrete saved-card selection becomes the appointment's payment method; the
      // 'send-link' and defer options leave it unset (collect/authorize later).
      const paymentMethodId =
        paymentSelection && paymentSelection !== "send-link" && paymentSelection !== DEFER_CARD
          ? paymentSelection
          : null;

      // Handle recurring appointments
      if (recurrenceType !== "none") {
        const response = await fetch("/api/recurring-appointments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            organizationId: currentOrganizationId,
            homeownerId: selectedHomeowner.id,
            cleanerId: selectedCleaner.id,
            propertyId: selectedProperty.id,
            serviceTypeId: selectedServiceType.id,
            checklistId: selectedChecklist.id,
            startDate: scheduledDate,
            startTime: scheduledTime,
            durationMinutes: selectedServiceType.duration_minutes,
            totalPrice: finalPrice,
            priceOverrideEnabled: priceOverrideEnabled,
            priceOverrideTotal:
              priceOverrideEnabled && customPrice
                ? parseFloat(customPrice)
                : null,
            recurrenceType: recurrenceType,
            interval: recurrenceInterval,
            daysOfWeek:
              recurrenceType === "weekly" ? selectedDaysOfWeek : undefined,
            endDate: recurrenceEndType === "date" ? recurrenceEndDate : null,
            maxOccurrences:
              recurrenceEndType === "occurrences"
                ? recurrenceMaxOccurrences
                : null,
            specialRequests: specialRequests || null,
            status: initialStatus,
          }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.error || "Failed to create recurring appointments",
          );
        }

        console.log("Recurring appointments created:", result.data);

        // Success! Close modal and refresh
        onAppointmentCreated();
        handleClose();
        return;
      }

      // Handle single appointment (existing logic)
      const responseDeadline = computeResponseDeadlineISO(
        scheduledDate,
        scheduledTime,
      );
      const { data: insertData, error: insertError } = await supabase
        .from("appointments")
        .insert({
          organization_id: currentOrganizationId,
          homeowner_id: selectedHomeowner.id,
          cleaner_id: selectedCleaner.id,
          property_id: selectedProperty.id,
          service_type_id: selectedServiceType.id,
          checklist_id: selectedChecklist.id,
          scheduled_date: scheduledDate,
          scheduled_time: scheduledTime,
          duration_minutes: selectedServiceType.duration_minutes,
          total_price: finalPrice,
          price_override_enabled: priceOverrideEnabled,
          price_override_total:
            priceOverrideEnabled && customPrice
              ? parseFloat(customPrice)
              : null,
          special_requests: specialRequests || null,
          payment_method_id: paymentMethodId,
          status: initialStatus,
          cleaner_confirmation_status: "awaiting",
          response_deadline: responseDeadline,
        })
        .select("id")
        .single();

      // If admin provided alternates, also write the primary + alts into
      // appointment_requested_slots so the cleaner sees inline chips and can
      // accept any of them (parity with the homeowner-initiated flow).
      if (!insertError && insertData?.id) {
        const filledAlts = alternateSlots.filter((s) => s.date && s.time);
        if (filledAlts.length > 0) {
          const slotRows = [
            {
              appointment_id: insertData.id,
              slot_index: 0,
              scheduled_date: scheduledDate,
              scheduled_time: scheduledTime,
            },
            ...filledAlts.map((s, i) => ({
              appointment_id: insertData.id,
              slot_index: i + 1,
              scheduled_date: s.date,
              scheduled_time: s.time,
            })),
          ];
          const { error: slotsError } = await supabase
            .from("appointment_requested_slots")
            .insert(slotRows);
          if (slotsError) {
            console.error("Failed to insert alternate slots:", slotsError);
            // Non-fatal: the appointment still exists with its primary time.
          }
        }
      }

      if (insertError) {
        console.error("Insert error details:", {
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          code: insertError.code,
          fullError: insertError,
        });
        throw insertError;
      }

      console.log("Appointment created successfully:", insertData);

      // If a saved card was chosen, place the authorization hold now (immediate feedback;
      // the JIT cron is the backstop for deferred/cron-scheduled holds). The appointment
      // already exists, so an auth failure is surfaced but doesn't undo creation.
      if (paymentMethodId && insertData?.id) {
        try {
          const token = await getAccessToken();
          const authRes = await fetch(`/api/appointments/${insertData.id}/authorize`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ organization_id: currentOrganizationId }),
          });
          const authResult = await authRes.json().catch(() => ({}));
          if (!authRes.ok || (authResult.code !== "authorized" && authResult.code !== "requires_action")) {
            // Refresh the list (the appointment exists) but keep the modal open so the admin
            // sees why the hold didn't land and can retry from the appointment.
            onAppointmentCreated();
            setError(
              `Appointment created, but the card hold failed: ${
                authResult.message || authResult.error || "authorization error"
              }. You can retry from the appointment.`,
            );
            setIsCreating(false);
            return;
          }
        } catch (authErr) {
          onAppointmentCreated();
          setError(
            `Appointment created, but the card hold failed: ${
              authErr instanceof Error ? authErr.message : "authorization error"
            }. You can retry from the appointment.`,
          );
          setIsCreating(false);
          return;
        }
      }

      // Success! Close modal and refresh
      onAppointmentCreated();
      handleClose();
    } catch (err) {
      console.error("Error creating appointment:", err);
      let errorMessage = "Failed to create appointment";

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "object" && err !== null) {
        if ("message" in err) {
          errorMessage = String(err.message);
        } else if ("details" in err) {
          errorMessage = String(err.details) || errorMessage;
        } else if ("hint" in err) {
          errorMessage = String(err.hint) || errorMessage;
        }
      }

      // Also log the full error for debugging
      console.error("Full error object:", JSON.stringify(err, null, 2));

      setError(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    // Reset all state
    setCurrentStep(1);
    setMobileSubStep("homeowner");
    if (!preSelectedHomeownerId) {
      setSelectedHomeowner(null);
    }
    if (!preSelectedPropertyId) {
      setSelectedProperty(null);
    }
    setSelectedServiceType(null);
    setChecklists([]);
    setSelectedChecklist(null);
    setScheduledDate("");
    setScheduledTime("");
    setAlternateSlots([]);
    setSpecialRequests("");
    setPaymentSelection(null);
    setSelectedCleaner(null);
    setHomeownerSearch("");
    setPropertySearch("");
    setCleanerSearch("");
    // Reset recurrence state
    setRecurrenceType("none");
    setRecurrenceInterval(1);
    setSelectedDaysOfWeek([]);
    setRecurrenceEndType("date");
    setRecurrenceEndDate("");
    setRecurrenceMaxOccurrences(10);
    // Reset price override state
    setCustomPrice("");
    setPriceOverrideEnabled(false);
    // Reset payment state
    setPaymentMethodSaved(false);
    setSkipPaymentMethod(false);
    setError(null);
    onClose();
  };

  const handleNext = () => {
    setError(null);
    setCurrentStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setError(null);
    setCurrentStep((prev) => prev - 1);
  };

  // Filter functions
  const filteredHomeowners = homeowners.filter((h) => {
    const searchLower = homeownerSearch.toLowerCase();
    return (
      h.first_name.toLowerCase().includes(searchLower) ||
      h.last_name.toLowerCase().includes(searchLower) ||
      h.email.toLowerCase().includes(searchLower)
    );
  });

  const filteredProperties = properties.filter((p) => {
    const searchLower = propertySearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(searchLower) ||
      p.address.toLowerCase().includes(searchLower) ||
      p.city.toLowerCase().includes(searchLower)
    );
  });

  const filteredCleaners = cleaners.filter((c) => {
    if (!c.user_profile) return false;
    const searchLower = cleanerSearch.toLowerCase();
    return (
      c.user_profile.first_name.toLowerCase().includes(searchLower) ||
      c.user_profile.last_name.toLowerCase().includes(searchLower)
    );
  });

  // Validation
  const isStep1Valid = selectedHomeowner && selectedProperty;
  const isStep2Valid =
    selectedServiceType &&
    selectedChecklist &&
    scheduledDate &&
    scheduledTime &&
    (hidePriceOverride ||
      !priceOverrideEnabled ||
      (customPrice && parseFloat(customPrice) > 0));
  const isStep3Valid = !!selectedCleaner;
  const isStep4Valid = paymentMethodSaved || skipPaymentMethod;

  // Get today's date for min date validation (using local timezone, not UTC)
  const getTodayLocal = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const today = getTodayLocal();

  // Get current time for min time validation when date is today
  const getMinTime = () => {
    if (scheduledDate === today) {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    }
    return "00:00";
  };

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayScrollRef}
      className="fixed inset-0 z-[300] flex"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className="relative w-full flex flex-col bg-white min-h-dvh overflow-hidden animate-sheet-up sm:animate-slide-up sm:m-auto sm:max-w-4xl sm:min-h-0 sm:max-h-[90vh] sm:rounded-2xl sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 relative bg-gradient-to-r from-primary-600 to-primary-700 text-white px-6 sm:px-8 pt-[max(env(safe-area-inset-top),1.25rem)] pb-5">
          {/* Close button */}
          <button
            onClick={handleClose}
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
          <h2 className="text-2xl font-bold text-center mb-2">
            New Appointment
          </h2>
          <p className="text-primary-100 text-center text-sm">
            Step {currentStep} of{" "}
            {preSelectedHomeownerId && preSelectedPropertyId ? 2 : 3}
          </p>

            {/* Step indicator */}
            <div className="flex justify-center gap-2 mt-4">
              {preSelectedHomeownerId && preSelectedPropertyId ? (
                // 2 steps: details + cleaner (combined), payment
                <>
                  <div
                    className={`h-1 w-12 rounded-full transition-colors ${
                      currentStep >= 1 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                  <div
                    className={`h-1 w-12 rounded-full transition-colors ${
                      currentStep >= 2 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                </>
              ) : (
                // 3 steps: homeowner/property (or property only), details + cleaner, payment
                <>
                  <div
                    className={`h-1 w-12 rounded-full transition-colors ${
                      currentStep >= 1 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                  <div
                    className={`h-1 w-12 rounded-full transition-colors ${
                      currentStep >= 2 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                  <div
                    className={`h-1 w-12 rounded-full transition-colors ${
                      currentStep >= 3 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                </>
              )}
            </div>
          </div>

          {/* Content */}
          <div
            ref={modalBodyScrollRef}
            className="flex-1 overflow-y-auto px-6 sm:px-8 py-6"
          >
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            {/* Step 1: Select Homeowner & Property (skip if pre-selected) */}
            {currentStep === 1 &&
              !preSelectedHomeownerId &&
              !preSelectedPropertyId && (
                <div className="space-y-6">
                  {/* Homeowner Selection */}
                  <div
                    className={`${
                      mobileSubStep === "homeowner" ? "block" : "hidden"
                    } sm:block ${
                      mobileSubStep === "homeowner" ? "animate-slide-in-left" : ""
                    } sm:animate-none`}
                  >
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">
                      Select Homeowner
                    </h3>

                    <div className="flex gap-2 mb-4">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <input
                          type="text"
                          placeholder="Search homeowners..."
                          value={homeownerSearch}
                          onChange={(e) => setHomeownerSearch(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                      <button
                        type="button"
                        className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Add New
                      </button>
                    </div>

                    {homeownersLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                      </div>
                    ) : filteredHomeowners.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No homeowners found
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:max-h-48 sm:overflow-y-auto">
                        {filteredHomeowners.map((homeowner) => (
                          <button
                            key={homeowner.id}
                            type="button"
                            onClick={() => {
                              setSelectedHomeowner(homeowner);
                              // Auto-advance to property sub-step on mobile (no-op visually on desktop)
                              setMobileSubStep("property");
                            }}
                            className={`p-4 border-2 rounded-lg text-left transition-all ${
                              selectedHomeowner?.id === homeowner.id
                                ? "border-primary-500 bg-primary-50"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                  <User className="w-5 h-5 text-primary-600" />
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {homeowner.first_name} {homeowner.last_name}
                                  </p>
                                  <p className="text-sm text-gray-600">
                                    {homeowner.email}
                                  </p>
                                </div>
                              </div>
                              {selectedHomeowner?.id === homeowner.id && (
                                <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Property Selection */}
                  {selectedHomeowner && (
                    <div
                      className={`${
                        mobileSubStep === "property" ? "block" : "hidden"
                      } sm:block ${
                        mobileSubStep === "property" ? "animate-slide-in-right" : ""
                      } sm:animate-none`}
                    >
                      {/* Mobile-only: back-to-homeowner pill showing current selection */}
                      <button
                        type="button"
                        onClick={() => setMobileSubStep("homeowner")}
                        className="sm:hidden w-full flex items-center gap-3 p-3 mb-4 bg-primary-50 border border-primary-200 rounded-lg text-left hover:bg-primary-100 transition-colors"
                      >
                        <ChevronLeft className="w-5 h-5 text-primary-700 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-primary-700 font-medium">
                            Homeowner
                          </p>
                          <p className="text-sm text-gray-900 font-semibold truncate">
                            {selectedHomeowner.first_name}{" "}
                            {selectedHomeowner.last_name}
                          </p>
                        </div>
                        <span className="text-xs text-primary-700 font-medium">
                          Change
                        </span>
                      </button>

                      <h3 className="text-lg font-semibold text-gray-900 mb-3">
                        Select Property
                      </h3>

                      <div className="flex gap-2 mb-4">
                        <div className="flex-1 relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                          <input
                            type="text"
                            placeholder="Search properties..."
                            value={propertySearch}
                            onChange={(e) => setPropertySearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <button
                          type="button"
                          className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Add New
                        </button>
                      </div>

                      {propertiesLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                        </div>
                      ) : filteredProperties.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          No properties found for this homeowner
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:max-h-48 sm:overflow-y-auto">
                          {filteredProperties.map((property) => (
                            <button
                              key={property.id}
                              type="button"
                              onClick={() => setSelectedProperty(property)}
                              className={`p-4 border-2 rounded-lg text-left transition-all ${
                                selectedProperty?.id === property.id
                                  ? "border-primary-500 bg-primary-50"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                    <Home className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div>
                                    <p className="font-medium text-gray-900">
                                      {property.name}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                      {property.address}, {property.city}
                                    </p>
                                  </div>
                                </div>
                                {selectedProperty?.id === property.id && (
                                  <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            {/* Step 1: Select Property (when only homeowner is pre-selected) */}
            {currentStep === 1 &&
              preSelectedHomeownerId &&
              !preSelectedPropertyId && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    Select Property
                  </h3>

                  <div className="flex gap-2 mb-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        placeholder="Search properties..."
                        value={propertySearch}
                        onChange={(e) => setPropertySearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <button
                      type="button"
                      className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add New
                    </button>
                  </div>

                  {propertiesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                    </div>
                  ) : filteredProperties.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      No properties found for this homeowner
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto">
                      {filteredProperties.map((property) => (
                        <button
                          key={property.id}
                          type="button"
                          onClick={() => setSelectedProperty(property)}
                          className={`p-4 border-2 rounded-lg text-left transition-all ${
                            selectedProperty?.id === property.id
                              ? "border-primary-500 bg-primary-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                <Home className="w-5 h-5 text-blue-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {property.name}
                                </p>
                                <p className="text-sm text-gray-600">
                                  {property.address}, {property.city}
                                </p>
                              </div>
                            </div>
                            {selectedProperty?.id === property.id && (
                              <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

            {/* Step 2: Appointment Details (or Step 1 when homeowner/property pre-selected) */}
            {((preSelectedHomeownerId &&
              preSelectedPropertyId &&
              currentStep === 1) ||
              (preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 2) ||
              (!preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 2)) && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Appointment Details
                </h3>

                {/* Service Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Service Type *
                  </label>
                  {serviceTypesLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                    </div>
                  ) : (
                    <select
                      value={selectedServiceType?.id || ""}
                      onChange={(e) => {
                        const serviceType = serviceTypes.find(
                          (s) => s.id === e.target.value,
                        );
                        setSelectedServiceType(serviceType || null);
                        setSelectedChecklist(null);
                        setChecklists([]);
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    >
                      <option value="">Select a service type</option>
                      {serviceTypes.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} - ${service.base_price} (
                          {service.duration_minutes} min)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Checklist */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Checklist *
                  </label>
                  <select
                    value={selectedChecklist?.id || ""}
                    disabled={!selectedServiceType || checklistsLoading}
                    onChange={(e) => {
                      const checklist = checklists.find(
                        (c) => c.id === e.target.value,
                      );
                      setSelectedChecklist(checklist || null);
                      if (
                        priceOverrideEnabled &&
                        selectedServiceType &&
                        checklist
                      ) {
                        const systemTotal =
                          selectedServiceType.base_price +
                          (checklist.price_adder || 0);
                        setCustomPrice(systemTotal.toString());
                      }
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    required
                  >
                    <option value="">
                      {!selectedServiceType
                        ? "Select a service type first"
                        : checklistsLoading
                          ? "Loading checklists…"
                          : "Select a checklist"}
                    </option>
                    {checklists.map((checklist) => (
                      <option key={checklist.id} value={checklist.id}>
                        {`${checklist.name} (+${(checklist.price_adder ?? 0).toFixed(2)})`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Price Display (with optional override for admin/manager) */}
                {selectedServiceType && selectedChecklist && (
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        {!hidePriceOverride && priceOverrideEnabled ? (
                          <div className="flex items-center gap-2 w-full max-w-full">
                            <span className="text-lg font-medium text-gray-700">
                              $
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={customPrice}
                              onChange={(e) => setCustomPrice(e.target.value)}
                              placeholder="Enter custom price"
                              className="flex-1 min-w-0 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
                            />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-sm text-gray-600">
                              Base: ${selectedServiceType.base_price.toFixed(2)}
                            </p>
                            <p className="text-sm text-gray-600">
                              Checklist adder: +$
                              {selectedChecklist.price_adder.toFixed(2)}
                            </p>
                            <div className="text-2xl font-bold text-gray-900 pt-1">
                              ${getSystemCalculatedPrice().toFixed(2)}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2 text-right">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-5 h-5 text-primary-600 shrink-0" />
                          <span className="font-medium text-gray-900">
                            Price
                          </span>
                        </div>
                        {!hidePriceOverride && (
                          <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer leading-snug">
                            <input
                              type="checkbox"
                              checked={priceOverrideEnabled}
                              onChange={(e) => {
                                setPriceOverrideEnabled(e.target.checked);
                                if (!e.target.checked) {
                                  setCustomPrice("");
                                } else {
                                  const systemTotal =
                                    getSystemCalculatedPrice();
                                  setCustomPrice(systemTotal.toString());
                                }
                              }}
                              className="w-4 h-4 mt-0.5 text-primary-600 border-gray-300 rounded focus:ring-primary-500 shrink-0"
                            />
                            <span>Override price</span>
                          </label>
                        )}
                      </div>
                    </div>

                    {!hidePriceOverride &&
                      priceOverrideEnabled &&
                      customPrice &&
                      parseFloat(customPrice) !==
                        getSystemCalculatedPrice() && (
                        <p className="mt-2 text-xs text-gray-500">
                          Calculated total: $
                          {getSystemCalculatedPrice().toFixed(2)}
                          {parseFloat(customPrice) > getSystemCalculatedPrice()
                            ? ` (+$${(
                                parseFloat(customPrice) -
                                getSystemCalculatedPrice()
                              ).toFixed(2)})`
                            : ` (-$${(
                                getSystemCalculatedPrice() -
                                parseFloat(customPrice)
                              ).toFixed(2)})`}
                        </p>
                      )}
                  </div>
                )}

                {/* Preferred date & time (primary + up to 2 alternates) */}
                <SlotPicker
                  slots={[{ date: scheduledDate, time: scheduledTime }, ...alternateSlots]}
                  onChange={(next) => {
                    const primary = next[0] ?? { date: "", time: "" };
                    setScheduledDate(primary.date);
                    setScheduledTime(primary.time);
                    setAlternateSlots(next.slice(1));
                    setError(null);
                  }}
                  minDate={today}
                  todayLocalStr={today}
                  minTimeForToday={getMinTime()}
                />
                {scheduledDate === today && scheduledTime && (
                  <p className="mt-1 text-xs text-gray-500">
                    Today selected — pick a time after{" "}
                    {new Date().toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}

                {/* Special Requests */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Special Requests (Optional)
                  </label>
                  <textarea
                    value={specialRequests}
                    onChange={(e) => setSpecialRequests(e.target.value)}
                    rows={4}
                    placeholder="Any special instructions or requests for this appointment..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  />
                </div>

                {/* Payment (new charge flow only; renders null when the flag is off) */}
                <AppointmentPaymentSection
                  homeownerId={selectedHomeowner?.id ?? null}
                  organizationId={currentOrganizationId ?? null}
                  value={paymentSelection}
                  onChange={setPaymentSelection}
                />

                {/* Assign Cleaner. Uniform rows for both groups. Available rows
                    select on click; not-available rows expand on click and only
                    select when the admin confirms via the inline button. */}
                <div className="border-t border-gray-200 pt-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-primary-600" />
                    <h4 className="text-md font-semibold text-gray-900">
                      Assign Cleaner
                    </h4>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search cleaners..."
                      value={cleanerSearch}
                      onChange={(e) => setCleanerSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>

                  {cleanersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                    </div>
                  ) : filteredCleaners.length === 0 ? (
                    <div className="text-center py-8 text-sm text-gray-500">
                      No cleaners found
                    </div>
                  ) : !candidateSlot ? (
                    <>
                      <p className="text-xs text-gray-500">
                        Pick a date, time, and service above to see who&apos;s
                        available.
                      </p>
                      <div className="space-y-2">
                        {rankedCleaners
                          .filter((r) =>
                            filteredCleaners.some(
                              (fc) => fc.id === r.cleaner.id,
                            ),
                          )
                          .map(({ cleaner }) => {
                            const isSelected =
                              selectedCleaner?.id === cleaner.id;
                            return (
                              <button
                                key={cleaner.id}
                                type="button"
                                onClick={() => setSelectedCleaner(cleaner)}
                                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-left transition-colors ${
                                  isSelected
                                    ? "border-2 border-primary-500 bg-primary-50"
                                    : "border-gray-200 bg-white hover:border-gray-300"
                                }`}
                              >
                                <span className="text-sm font-medium text-gray-900">
                                  {cleaner.user_profile?.first_name}{" "}
                                  {cleaner.user_profile?.last_name}
                                </span>
                                {isSelected ? (
                                  <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                                ) : (
                                  <span className="text-xs text-gray-400">
                                    Pick a time
                                  </span>
                                )}
                              </button>
                            );
                          })}
                      </div>
                    </>
                  ) : (
                    (() => {
                      const visibleRanked = rankedCleaners.filter((r) =>
                        filteredCleaners.some((fc) => fc.id === r.cleaner.id),
                      );
                      const available = visibleRanked.filter(
                        (r) => r.isAvailable,
                      );
                      const unavailable = visibleRanked.filter(
                        (r) => !r.isAvailable,
                      );
                      return (
                        <div className="space-y-5">
                          {/* Available group */}
                          {available.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-500">
                                Available · {available.length}
                              </p>
                              <div className="space-y-2">
                                {available.map(({ cleaner }) => {
                                  const isSelected =
                                    selectedCleaner?.id === cleaner.id;
                                  return (
                                    <button
                                      key={cleaner.id}
                                      type="button"
                                      onClick={() => setSelectedCleaner(cleaner)}
                                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-left transition-colors ${
                                        isSelected
                                          ? "border-2 border-primary-500 bg-primary-50"
                                          : "border-gray-200 bg-white hover:border-gray-300"
                                      }`}
                                    >
                                      <span className="text-sm font-medium text-gray-900">
                                        {cleaner.user_profile?.first_name}{" "}
                                        {cleaner.user_profile?.last_name}
                                      </span>
                                      {isSelected ? (
                                        <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                                      ) : (
                                        <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {available.length === 0 && unavailable.length > 0 && (
                            <p className="text-xs text-gray-500">
                              No cleaners are free at this time. Expand a
                              cleaner below to see their conflict and pick them
                              anyway.
                            </p>
                          )}

                          {/* Unavailable group — uniform rows, expand on click */}
                          {unavailable.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-500">
                                Not available · {unavailable.length}
                              </p>
                              <div className="space-y-2">
                                {unavailable.map(
                                  ({ cleaner, conflicts, nextFreeSlot }) => {
                                    const isSelected =
                                      selectedCleaner?.id === cleaner.id;
                                    const isExpanded =
                                      expandedCleanerId === cleaner.id ||
                                      isSelected;
                                    const firstName =
                                      cleaner.user_profile?.first_name ??
                                      "Cleaner";
                                    return (
                                      <div
                                        key={cleaner.id}
                                        className={`rounded-lg border transition-colors ${
                                          isSelected
                                            ? "border-2 border-primary-500 bg-primary-50"
                                            : "border-gray-200 bg-white"
                                        }`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedCleanerId((id) =>
                                              id === cleaner.id
                                                ? null
                                                : cleaner.id,
                                            )
                                          }
                                          aria-expanded={isExpanded}
                                          className="w-full flex items-center justify-between px-4 py-3 text-left"
                                        >
                                          <span className="text-sm font-medium text-gray-900">
                                            {cleaner.user_profile?.first_name}{" "}
                                            {cleaner.user_profile?.last_name}
                                          </span>
                                          <span className="flex items-center gap-2 flex-shrink-0">
                                            {isSelected ? (
                                              <CheckCircle className="w-5 h-5 text-primary-600" />
                                            ) : (
                                              <Ban className="w-4 h-4 text-gray-400" />
                                            )}
                                            <ChevronDown
                                              className={`w-4 h-4 text-gray-400 transition-transform ${
                                                isExpanded ? "rotate-180" : ""
                                              }`}
                                            />
                                          </span>
                                        </button>

                                        {isExpanded && (
                                          <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                                            <div>
                                              <p className="text-xs text-gray-500 mb-1">
                                                Conflicts with
                                              </p>
                                              <ul className="text-sm text-gray-700 space-y-0.5">
                                                {conflicts
                                                  .slice(0, 3)
                                                  .map((c) => (
                                                    <li key={c.id}>
                                                      {formatTimeTo12h(
                                                        c.scheduled_time,
                                                      )}{" "}
                                                      ·{" "}
                                                      {c.duration_minutes} min
                                                    </li>
                                                  ))}
                                                {conflicts.length > 3 && (
                                                  <li className="text-gray-500">
                                                    …and {conflicts.length - 3}{" "}
                                                    more
                                                  </li>
                                                )}
                                              </ul>
                                            </div>
                                            {nextFreeSlot ? (
                                              <p className="text-sm text-gray-700">
                                                <span className="text-gray-500">
                                                  Next free for {firstName}:
                                                </span>{" "}
                                                <span className="font-medium">
                                                  {formatTimeTo12h(
                                                    nextFreeSlot.time,
                                                  )}
                                                </span>{" "}
                                                <span className="text-xs text-gray-500">
                                                  · drive time not factored in
                                                </span>
                                              </p>
                                            ) : (
                                              <p className="text-sm text-gray-700">
                                                <span className="font-medium">
                                                  No same-day opening.
                                                </span>{" "}
                                                Try a different day.
                                              </p>
                                            )}
                                            <div className="flex justify-end">
                                              {isSelected ? (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    setSelectedCleaner(null)
                                                  }
                                                  className="text-xs text-gray-600 hover:text-gray-900 underline"
                                                >
                                                  Deselect
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    setSelectedCleaner(cleaner)
                                                  }
                                                  className="text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg px-3 py-1.5 transition-colors"
                                                >
                                                  Select {firstName} anyway
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}

                  {!selectedCleaner && cleaners.length > 0 && (
                    <p className="text-xs text-gray-500">
                      Pick a cleaner. They&apos;ll see the assignment and can
                      decline or counter-propose.
                    </p>
                  )}
                </div>

                {/* Recurrence Section */}
                <div className="border-t border-gray-200 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Repeat className="w-5 h-5 text-primary-600" />
                    <h4 className="text-md font-semibold text-gray-900">
                      Repeat Appointment
                    </h4>
                  </div>

                  {/* Recurrence Type */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Recurrence
                    </label>
                    <select
                      value={recurrenceType}
                      onChange={(e) => {
                        setRecurrenceType(e.target.value as RecurrenceType);
                        // Reset days of week when changing type
                        if (e.target.value !== "weekly") {
                          setSelectedDaysOfWeek([]);
                        } else if (scheduledDate) {
                          // Pre-select the day of the scheduled date for weekly
                          const dayOfWeek = new Date(scheduledDate).getDay();
                          setSelectedDaysOfWeek([dayOfWeek]);
                        }
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>

                  {/* Show recurrence options only when recurring */}
                  {recurrenceType !== "none" && (
                    <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                      {/* Interval */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Repeat every
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={recurrenceInterval}
                            onChange={(e) =>
                              setRecurrenceInterval(
                                Math.max(1, parseInt(e.target.value) || 1),
                              )
                            }
                            className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                          <span className="text-gray-600">
                            {recurrenceType === "daily" &&
                              (recurrenceInterval === 1 ? "day" : "days")}
                            {recurrenceType === "weekly" &&
                              (recurrenceInterval === 1 ? "week" : "weeks")}
                            {recurrenceType === "monthly" &&
                              (recurrenceInterval === 1 ? "month" : "months")}
                          </span>
                        </div>
                      </div>

                      {/* Days of Week (for weekly) */}
                      {recurrenceType === "weekly" && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            On these days *
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              "Sun",
                              "Mon",
                              "Tue",
                              "Wed",
                              "Thu",
                              "Fri",
                              "Sat",
                            ].map((day, index) => (
                              <button
                                key={day}
                                type="button"
                                onClick={() => {
                                  setSelectedDaysOfWeek((prev) =>
                                    prev.includes(index)
                                      ? prev.filter((d) => d !== index)
                                      : [...prev, index],
                                  );
                                }}
                                className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                                  selectedDaysOfWeek.includes(index)
                                    ? "bg-primary-600 text-white"
                                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                                }`}
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* End Condition */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Ends
                        </label>
                        <div className="space-y-3">
                          {/* End on date option */}
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="radio"
                              name="recurrenceEnd"
                              checked={recurrenceEndType === "date"}
                              onChange={() => setRecurrenceEndType("date")}
                              className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                            />
                            <span className="text-gray-700">On date</span>
                            {recurrenceEndType === "date" && (
                              <input
                                type="date"
                                value={recurrenceEndDate}
                                onChange={(e) =>
                                  setRecurrenceEndDate(e.target.value)
                                }
                                min={scheduledDate || today}
                                className="px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                            )}
                          </label>

                          {/* End after occurrences option */}
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="radio"
                              name="recurrenceEnd"
                              checked={recurrenceEndType === "occurrences"}
                              onChange={() =>
                                setRecurrenceEndType("occurrences")
                              }
                              className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                            />
                            <span className="text-gray-700">After</span>
                            {recurrenceEndType === "occurrences" && (
                              <>
                                <input
                                  type="number"
                                  min={1}
                                  max={50}
                                  value={recurrenceMaxOccurrences}
                                  onChange={(e) =>
                                    setRecurrenceMaxOccurrences(
                                      Math.max(
                                        1,
                                        Math.min(
                                          50,
                                          parseInt(e.target.value) || 1,
                                        ),
                                      ),
                                    )
                                  }
                                  className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                />
                                <span className="text-gray-700">
                                  occurrences
                                </span>
                              </>
                            )}
                          </label>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          Maximum 50 appointments will be created, up to 6
                          months in advance.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* Payment Method (step 3 normally, step 2 when homeowner/property pre-selected) */}
            {((preSelectedHomeownerId &&
              preSelectedPropertyId &&
              currentStep === 2) ||
              (preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 3) ||
              (!preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 3)) &&
              selectedHomeowner && (
                <div className="space-y-6">
                  <div className="flex items-center gap-2 mb-4">
                    <CreditCard className="w-5 h-5 text-primary-600" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      Payment Method
                    </h3>
                  </div>

                  <p className="text-gray-600 mb-4">
                    Collect payment information from{" "}
                    {selectedHomeowner.first_name} {selectedHomeowner.last_name}
                    . The card will be charged automatically when the cleaning
                    job is completed.
                  </p>

                  {paymentMethodSaved ? (
                    <div className="p-6 bg-green-50 border border-green-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                          <CheckCircle className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-green-800">
                            Payment Method Saved
                          </p>
                          <p className="text-sm text-green-600">
                            Card on file for {selectedHomeowner.email}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : skipPaymentMethod ? (
                    <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center">
                          <CreditCard className="w-6 h-6 text-yellow-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-yellow-800">
                            Payment Collection Skipped
                          </p>
                          <p className="text-sm text-yellow-600">
                            You can collect payment information later
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <PaymentMethodForm
                      homeownerId={selectedHomeowner.id}
                      onSuccess={() => {
                        setPaymentMethodSaved(true);
                      }}
                      onError={(errorMsg) => {
                        setError(errorMsg);
                      }}
                    />
                  )}

                  {/* Skip payment option */}
                  {!paymentMethodSaved && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skipPaymentMethod}
                          onChange={(e) => {
                            setSkipPaymentMethod(e.target.checked);
                          }}
                          className="w-5 h-5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        />
                        <div>
                          <p className="font-medium text-gray-900">
                            Skip payment collection
                          </p>
                          <p className="text-sm text-gray-600">
                            Collect payment information later or use manual
                            payment
                          </p>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-200 px-6 sm:px-8 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] bg-gray-50">
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-3">
              {currentStep === 1 ? (
                <>
                  {/* Mobile-only Back button when on property sub-step */}
                  {!preSelectedHomeownerId &&
                    !preSelectedPropertyId &&
                    mobileSubStep === "property" && (
                      <button
                        type="button"
                        onClick={() => setMobileSubStep("homeowner")}
                        className="sm:hidden w-full px-5 py-3 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                      >
                        Back
                      </button>
                    )}
                  {/* Cancel — hidden on mobile when on property sub-step */}
                  <button
                    type="button"
                    onClick={handleClose}
                    className={`${
                      !preSelectedHomeownerId &&
                      !preSelectedPropertyId &&
                      mobileSubStep === "property"
                        ? "hidden sm:inline-flex"
                        : "inline-flex"
                    } w-full sm:w-auto justify-center px-5 py-3 sm:py-2 text-gray-700 hover:bg-gray-100 sm:hover:bg-transparent sm:hover:text-gray-900 rounded-lg font-medium transition-colors`}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleBack}
                  className="w-full sm:w-auto px-5 py-3 sm:py-2 text-gray-700 hover:bg-gray-100 sm:hover:bg-transparent sm:hover:text-gray-900 rounded-lg font-medium transition-colors"
                >
                  Back
                </button>
              )}

              {(preSelectedHomeownerId &&
                preSelectedPropertyId &&
                currentStep < 2) ||
              (preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep < 3) ||
              (!preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep < 3) ? (
                <button
                  type="button"
                  onClick={() => {
                    // Mobile sub-step transition: homeowner → property
                    if (
                      currentStep === 1 &&
                      !preSelectedHomeownerId &&
                      !preSelectedPropertyId &&
                      mobileSubStep === "homeowner"
                    ) {
                      setMobileSubStep("property");
                      return;
                    }
                    handleNext();
                  }}
                  disabled={Boolean(
                    // Step 1 (no pre-selection): homeowner sub-step needs homeowner; property sub-step needs both
                    (currentStep === 1 &&
                      !preSelectedHomeownerId &&
                      !preSelectedPropertyId &&
                      (mobileSubStep === "homeowner"
                        ? !selectedHomeowner
                        : !isStep1Valid)) ||
                      (currentStep === 1 &&
                        preSelectedHomeownerId &&
                        !preSelectedPropertyId &&
                        !isStep1Valid) ||
                      // Step 1 (both pre-selected): combined details + cleaner
                      (currentStep === 1 &&
                        preSelectedHomeownerId &&
                        preSelectedPropertyId &&
                        (!isStep2Valid || !isStep3Valid)) ||
                      // Step 2 (other flows): combined details + cleaner
                      (currentStep === 2 &&
                        (!isStep2Valid || !isStep3Valid)),
                  )}
                  className="w-full sm:w-auto px-5 py-3 sm:py-2 bg-primary-600 text-white rounded-lg font-semibold shadow-sm hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateAppointment}
                  disabled={!isStep4Valid || isCreating}
                  className="w-full sm:w-auto px-5 py-3 sm:py-2 bg-primary-600 text-white rounded-lg font-semibold shadow-sm hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {recurrenceType !== "none"
                        ? "Creating Series..."
                        : "Sending..."}
                    </>
                  ) : hasConflicts ? (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      Create (override conflict)
                    </>
                  ) : (
                    <>
                      {recurrenceType !== "none" && (
                        <Repeat className="w-4 h-4" />
                      )}
                      {recurrenceType !== "none"
                        ? "Send Series to Cleaner for Confirmation"
                        : "Send to Cleaner for Confirmation"}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
    </div>,
    document.body,
  );
}
