'use client';

import { useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { preferredPaymentStatus } from './homeownerPaymentStatus';
import { useSavedPaymentMethods } from '../components/redesign/homeowner/account/payment-methods/useSavedPaymentMethods';
import type { SavedPaymentMethod } from '../components/redesign/shared/payment-methods/derive-payment-methods';

export interface Appointment {
  id: string;
  property_id?: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  cleaner_id?: string | null;
  cancelled_at?: string | null;
  cleaner_confirmation_status?: string | null;
  /** Non-null when this cleaning is one occurrence of a recurring series. */
  series_id?: string | null;
  total_price: number;
  special_requests?: string | null;
  /** Required by `POST /api/appointments/[id]/charge` and .../payment-method (Pay now, Update card). */
  organization_id?: string;
  /**
   * Card-hold/charge lifecycle for the new charge flow (migration 065). Distinguishes a plain
   * decline (`failed`) from an off-session 3DS bounce (`requires_action`) for the R7 payment
   * recovery section; `payment_status` alone conflates them.
   */
  authorization_status?: string | null;
  /**
   * True when the ORG's company card funds this cleaning (a comped booking can
   * still carry homeowner_id). A failed self-pay charge is the company's problem,
   * never the homeowner's; payment alerts must exclude these rows.
   */
  is_self_pay?: boolean | null;
  /** The Stripe payment method id saved to this appointment (card on file), if any. */
  payment_method_id?: string | null;
  /**
   * The homeowner's own saved card matching `payment_method_id` (resolved client-side against
   * `useSavedPaymentMethods`), for "Charged to Visa •••• 4242" style copy. Null while the saved
   * cards are still loading or when no match is found (e.g. the card was later removed).
   */
  payment_method_card?: SavedPaymentMethod | null;
  property: {
    name: string;
    address: string;
    city: string;
    state: string;
  } | null;
  service_type: {
    name: string;
    description: string;
  } | null;
  checklist?: {
    name: string;
    price_adder: number;
  } | null;
  cleaner_profile?: {
    user_profile: {
      first_name: string;
      last_name: string;
      avatar_url?: string | null;
    } | null;
  } | null;
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
  job_progress?: 'not_started' | 'before_photos' | 'checklist' | 'after_photos' | 'completed' | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms?: number;
  bathrooms?: number;
  square_feet?: number;
  photo_url?: string | null;
  special_instructions?: string | null;
  access_instructions?: string | null;
}

export interface HomeownerStats {
  totalCleanings: number;
  upcomingCleanings: number;
  totalSpent: number;
  favoriteCleaners: number;
}

export interface Message {
  id: string;
  subject?: string;
  content: string;
  is_read: boolean;
  created_at: string;
  sender_id: string;
  recipient_id: string;
  sender: {
    first_name: string;
    last_name: string;
    role: string;
  } | null;
  recipient: {
    first_name: string;
    last_name: string;
    role: string;
  } | null;
}

export interface Payment {
  id: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  paid_at?: string;
  created_at: string;
  appointment: {
    scheduled_date: string;
    service_type: {
      name: string;
    } | null;
  } | null;
}

export function useHomeownerAppointments() {
  const { user, currentOrganizationId } = useAuth();
  const userId = user?.id ?? '';
  const orgId = currentOrganizationId ?? '';
  const queryKey = keys.appointments.byHomeowner(userId);
  // Reused (not refetched) to resolve "card on file" metadata onto each appointment below.
  const { cards } = useSavedPaymentMethods();

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId, userId }) => {
      const { data, error: fetchError } = await supabase
        .from('appointments')
        .select(`
          id,
          organization_id,
          property_id,
          service_type_id,
          checklist_id,
          scheduled_date,
          scheduled_time,
          status,
          cleaner_id,
          series_id,
          total_price,
          special_requests,
          job_progress,
          started_at,
          completed_at,
          cancelled_at,
          cleaner_confirmation_status,
          authorization_status,
          is_self_pay,
          payment_method_id,
          property:properties(
            name,
            address,
            city,
            state
          ),
          service_type:service_types(
            name,
            description
          ),
          checklist:checklists(
            name,
            price_adder
          ),
          cleaner_profile:cleaner_profiles(
            user_profile:user_profiles(
              first_name,
              last_name,
              avatar_url
            )
          )
        `)
        .eq('homeowner_id', userId)
        .eq('organization_id', orgId)
        .order('scheduled_date', { ascending: true });

      if (fetchError) throw fetchError;

      const appointmentIds = (data || []).map(a => a.id);
      const paymentStatusMap: Record<string, 'pending' | 'paid' | 'failed' | 'refunded'> = {};
      if (appointmentIds.length > 0) {
        const { data: payments } = await supabase
          .from('payments')
          .select('appointment_id, status, created_at')
          .in('appointment_id', appointmentIds)
          .order('created_at', { ascending: false });
        if (payments) {
          // An appointment can have several payments rows (manual record + failed Stripe attempt,
          // a retry, a refund). Collapse them deterministically by precedence so payment_status
          // can't flip between refetches and a collected payment is never masked by a stray failed
          // row (see homeownerPaymentStatus.ts). Ordered newest-first so ties keep the recent row.
          for (const p of payments) {
            const next = preferredPaymentStatus(paymentStatusMap[p.appointment_id], p.status);
            if (next) paymentStatusMap[p.appointment_id] = next as 'pending' | 'paid' | 'failed' | 'refunded';
          }
        }
      }

      return (data || []).map(appointment => ({
        ...appointment,
        property: Array.isArray(appointment.property) ? appointment.property[0] : appointment.property,
        service_type: Array.isArray(appointment.service_type) ? appointment.service_type[0] : appointment.service_type,
        checklist: Array.isArray(appointment.checklist) ? appointment.checklist[0] : appointment.checklist,
        cleaner_profile: appointment.cleaner_profile && Array.isArray(appointment.cleaner_profile)
          ? {
              ...appointment.cleaner_profile[0],
              user_profile: Array.isArray(appointment.cleaner_profile[0]?.user_profile)
                ? appointment.cleaner_profile[0].user_profile[0]
                : appointment.cleaner_profile[0]?.user_profile,
            }
          : appointment.cleaner_profile,
        payment_status: paymentStatusMap[appointment.id] || null,
      })) as Appointment[];
    },
  });

  // Homeowner-scoped appointments realtime. Invalidates the list and any
  // dependent stats whenever an appointment of this homeowner changes.
  useSupabaseRealtimeSync({
    channelName: `appointments:homeowner:${userId}`,
    table: 'appointments',
    filter: userId ? `homeowner_id=eq.${userId}` : undefined,
    enabled: !!userId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [queryKey, keys.stats.homeowner(userId)],
    }),
  });

  // Payments don't carry homeowner_id, so we filter by org and let the
  // callback narrow to "is this appointment in the homeowner's cache?"
  // before invalidating. Avoids cross-homeowner refetch storms.
  useSupabaseRealtimeSync({
    channelName: `payments:homeowner:${userId}`,
    table: 'payments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId && !!userId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [queryKey, keys.payments.byHomeowner(userId), keys.stats.homeowner(userId)],
    }),
  });

  // Resolved separately from the queryFn (rather than inline there) so a saved-card change
  // (e.g. after "Update card") re-derives card metadata on every render without needing to
  // refetch the appointments query itself.
  const appointments = useMemo(
    () =>
      (query.data ?? []).map((appointment) => ({
        ...appointment,
        payment_method_card: appointment.payment_method_id
          ? (cards.find((c) => c.id === appointment.payment_method_id) ?? null)
          : null,
      })),
    [query.data, cards],
  );

  return {
    appointments,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useHomeownerProperties() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const queryKey = keys.properties.byHomeowner(userId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId, userId }) => {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('owner_id', userId)
        .eq('organization_id', orgId)
        .is('archived_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as Property[];
    },
  });

  useSupabaseRealtimeSync({
    channelName: `properties:homeowner:${userId}`,
    table: 'properties',
    filter: userId ? `owner_id=eq.${userId}` : undefined,
    enabled: !!userId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  return {
    properties: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useHomeownerStats() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: keys.stats.homeowner(userId),
    queryFn: async ({ orgId, userId }) => {
      const [totalRes, upcomingRes, paidPaymentsRes, completedCleanerRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('homeowner_id', userId)
          .eq('organization_id', orgId)
          .eq('status', 'completed'),
        supabase
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('homeowner_id', userId)
          .eq('organization_id', orgId)
          .in('status', ['pending', 'confirmed']),
        supabase
          .from('payments')
          .select('amount, appointments!inner(homeowner_id, organization_id)')
          .eq('appointments.homeowner_id', userId)
          .eq('appointments.organization_id', orgId)
          .eq('status', 'paid'),
        supabase
          .from('appointments')
          .select('cleaner_id')
          .eq('homeowner_id', userId)
          .eq('organization_id', orgId)
          .eq('status', 'completed')
          .not('cleaner_id', 'is', null),
      ]);

      const totalSpent =
        paidPaymentsRes.data?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0;

      const cleanerJobCounts = (completedCleanerRes.data ?? []).reduce(
        (acc, appointment) => {
          const cleanerId = appointment.cleaner_id;
          if (cleanerId) acc[cleanerId] = (acc[cleanerId] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const favoriteCleaners = Object.values(cleanerJobCounts).filter(c => c >= 2).length;

      return {
        totalCleanings: totalRes.count ?? 0,
        upcomingCleanings: upcomingRes.count ?? 0,
        totalSpent,
        favoriteCleaners,
      } as HomeownerStats;
    },
  });

  return {
    stats: query.data ?? {
      totalCleanings: 0,
      upcomingCleanings: 0,
      totalSpent: 0,
      favoriteCleaners: 0,
    },
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export function useHomeownerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: ['messages', 'homeowner', userId] as const,
    queryFn: async ({ orgId, userId }) => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id,
          subject,
          content,
          is_read,
          created_at,
          sender_id,
          recipient_id,
          sender:user_profiles!sender_id(
            first_name,
            last_name,
            role
          ),
          recipient:user_profiles!recipient_id(
            first_name,
            last_name,
            role
          )
        `)
        .eq('organization_id', orgId)
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(message => ({
        ...message,
        sender: Array.isArray(message.sender) ? message.sender[0] : message.sender,
        recipient: Array.isArray(message.recipient) ? message.recipient[0] : message.recipient,
      })) as Message[];
    },
  });

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export function useHomeownerPayments() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: keys.payments.byHomeowner(userId),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id,
          amount,
          status,
          charge_kind,
          processing_fee_cents,
          is_self_pay,
          paid_at,
          created_at,
          appointment:appointments(
            scheduled_date,
            homeowner_id,
            service_type:service_types(
              name
            )
          )
        `)
        .eq('organization_id', orgId)
        // Self-pay rows are the company paying on the homeowner's behalf (a comped cleaning); the
        // homeowner never paid them, so they must not appear as the homeowner's own receipts.
        .eq('is_self_pay', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(payment => ({
        ...payment,
        appointment: Array.isArray(payment.appointment)
          ? {
              ...payment.appointment[0],
              service_type: Array.isArray(payment.appointment[0]?.service_type)
                ? payment.appointment[0].service_type[0]
                : payment.appointment[0]?.service_type,
            }
          : payment.appointment,
      })) as Payment[];
    },
  });

  return {
    payments: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
