'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { pageRange, nextPageParam, PAYMENTS_PAGE_SIZE } from '../lib/pagination';
import { chargeCompletedAppointmentClient } from '../lib/payments/authorizeClient';
import {
  MANAGER_FLAG_SELECT,
  coerceManagerPermissions,
  type ManagerPermissions,
} from '../lib/permissions/managerFlags';
import { planPropertyDeletion, LIVE_APPT_STATUSES, HISTORY_APPT_STATUSES } from '@/lib/properties/deletePlan';

export type { ManagerPermissions } from '../lib/permissions/managerFlags';

export interface AdminAppointment {
  id: string;
  organization_id?: string | null;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  /** Length of the appointment in minutes (DB column). */
  duration_minutes?: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  /** Stamped by the lifecycle route when the cleaner starts the job. */
  started_at?: string | null;
  total_price: number;
  special_requests?: string | null;
  notes?: string | null;
  series_id?: string | null;
  cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected';
  /** cleaner_profiles.id of the assigned cleaner (= the user id). Null when unassigned. */
  cleaner_id?: string | null;
  price_override_enabled?: boolean;
  price_override_total?: number | null;
  homeowner_id?: string;
  homeowner: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  cleaner_profile?: {
    user_profile: {
      id: string;
      first_name: string;
      last_name: string;
      email?: string;
    } | null;
  } | null;
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
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
  /** True when the org paid from its company card (no homeowner involved). */
  is_self_pay?: boolean;
  /** Cleaner used the photo-gate skip for this job (org allows skipping). */
  photos_skipped?: boolean;
  photo_skip_reason?: string | null;
  /**
   * Card-hold (authorization) lifecycle for the new charge flow (migration 065).
   * Drives the "Card held / Auth failed / Captured" indicator next to the payment badge.
   */
  authorization_status?:
    | 'none'
    | 'scheduled'
    | 'authorizing'
    | 'requires_action'
    | 'authorized'
    | 'captured'
    | 'canceled'
    | 'failed'
    | null;
  /** The Stripe payment method id saved to this appointment (card on file), if any. */
  payment_method_id?: string | null;
  /**
   * Wave 2 SLA: timestamp by which the cleaner must respond. Null once they
   * have. Overdue is derived client-side via isAppointmentOverdue.
   */
  response_deadline?: string | null;
  /**
   * Latest cleaner-availability feedback (counter-proposal data). Joined for
   * the Bookings page's "Needs your response" section so the admin can
   * one-click accept a cleaner-suggested time.
   */
  cleaner_availability_feedback?: Array<{
    id: string;
    cleaner_id: string;
    reason: string | null;
    cleaner_suggested_times?: Array<{
      id: string;
      suggested_date: string;
      suggested_time: string;
    }> | null;
    cleaner_suggested_windows?: Array<{
      id: string;
      window_date: string;
      start_time: string;
      end_time: string;
    }> | null;
  }> | null;
}

export interface AdminCleaner {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    avatar_url?: string | null;
  } | null;
  rating: number;
  total_jobs: number;
  is_available: boolean;
  experience_years?: number;
  hourly_rate?: number;
  background_check_verified: boolean;
  insurance_verified: boolean;
  payout_percent: number;
  /** Unified pay mode ('percentage' | 'flat' | 'request' | 'hourly_external'). */
  payout_model: string;
  /** NULL = no pay decision was ever made for this cleaner ("Pay not set"). */
  payout_configured_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: boolean;
}

export interface AdminStats {
  totalBookings: number;
  activeCleaners: number;
  totalRevenue: number;
  pendingApprovals: number;
  monthlyGrowth: number;
  completionRate: number;
  avgRating: number;
  avgJobsPerDay: number;
  avgJobValue: number;
}

export interface AdminPayment {
  id: string;
  amount: number;
  status: 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';
  /** 'revenue' | 'expense' | 'refund'. Already fetched by the select. */
  payment_type?: string;
  /** 'card' | 'ach' | 'manual'. Already fetched by the select. */
  payment_method?: string;
  /** 'completion' | 'cancellation_fee' | null — distinguishes a job charge from a
   *  cancellation/no-show fee so a failed fee isn't mistaken for a failed job charge. */
  charge_kind?: 'completion' | 'cancellation_fee' | null;
  reference?: string;
  notes?: string;
  paid_at?: string;
  created_at: string;
  /** True when this payment was funded by an org self-pay charge (no homeowner). */
  is_self_pay?: boolean;
  /** Present only for Stripe-backed charges. Refundability derives from this, not
   *  payment_method: a manual 'card' row has none and can't be refunded; a settled
   *  ACH charge has one and can. */
  stripe_payment_intent_id?: string | null;
  /** Raw Stripe PI status on the latest attempt. 'requires_action' marks a 3DS-blocked fee,
   *  where a retry can't succeed until the customer verifies or swaps the card. */
  payment_intent_status?: string | null;
  /** Refund rows against this payment. `amount` is CENTS. Used to show refunded
   *  totals and cap the refundable remainder (pending + succeeded reduce it). */
  refunds?: { amount: number; status: string }[];
  appointment: {
    /** Only fetched by the infinite payments select (drives "View booking"). */
    id?: string;
    scheduled_date: string;
    homeowner: {
      first_name: string;
      last_name: string;
    } | null;
    service_type: {
      name: string;
    } | null;
  } | null;
}

export interface AdminMessage {
  id: string;
  subject?: string;
  content: string;
  is_read: boolean;
  created_at: string;
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
  appointment_id?: string;
}

export function useAdminAppointments() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.appointments.byOrg(orgId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id,
          organization_id,
          service_type_id,
          checklist_id,
          scheduled_date,
          scheduled_time,
          duration_minutes,
          status,
          started_at,
          total_price,
          authorization_status,
          payment_method_id,
          special_requests,
          notes,
          photos_skipped,
          photo_skip_reason,
          series_id,
          cleaner_confirmation_status,
          response_deadline,
          price_override_enabled,
          price_override_total,
          homeowner_id,
          is_self_pay,
          cleaner_id,
          homeowner:user_profiles!homeowner_id(
            first_name,
            last_name,
            email,
            phone
          ),
          cleaner_profile:cleaner_profiles(
            user_profile:user_profiles!id(
              id,
              first_name,
              last_name,
              email
            )
          ),
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
          cleaner_availability_feedback (
            id,
            cleaner_id,
            reason,
            cleaner_suggested_times ( id, suggested_date, suggested_time ),
            cleaner_suggested_windows ( id, window_date, start_time, end_time )
          ),
          appointment_requested_slots (
            slot_index,
            scheduled_date,
            scheduled_time
          )
        `)
        .eq('organization_id', orgId)
        .order('scheduled_date', { ascending: false });

      if (error) throw error;

      const appointmentIds = (data || []).map(a => a.id);
      let paymentStatusMap: Record<string, 'pending' | 'paid' | 'failed' | 'refunded'> = {};
      if (appointmentIds.length > 0) {
        const { data: payments } = await supabase
          .from('payments')
          .select('appointment_id, status')
          .in('appointment_id', appointmentIds);
        if (payments) {
          paymentStatusMap = payments.reduce((acc, p) => {
            acc[p.appointment_id] = p.status;
            return acc;
          }, {} as Record<string, 'pending' | 'paid' | 'failed' | 'refunded'>);
        }
      }

      return (data || []).map(appointment => ({
        ...appointment,
        homeowner: Array.isArray(appointment.homeowner) ? appointment.homeowner[0] : appointment.homeowner,
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
      })) as AdminAppointment[];
    },
  });

  // Appointments realtime: invalidate the list on any change. Refetch picks up
  // joins that the realtime payload doesn't carry (homeowner, cleaner, etc.).
  // Also invalidate admin stats and customer counts — both derive from this
  // table.
  useSupabaseRealtimeSync({
    channelName: `appointments:${orgId}`,
    table: 'appointments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      // Routing-log rows change alongside appointment updates (decline,
      // expiry, next-attempt dispatch), so this event doubles as the
      // invalidation signal for the sheet's routing-history section.
      keys: [queryKey, keys.stats.admin(orgId), keys.customers.byOrg(orgId), ['appointments', 'routing-log']],
    }),
  });

  // Payments realtime: patch payment_status into the appointments cache and
  // invalidate the derived stats RPCs. Filter by org so we don't broadcast
  // every payment in the database to every admin tab.
  useSupabaseRealtimeSync({
    channelName: `payments:${orgId}`,
    table: 'payments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: payload => {
      const row = (payload.new ?? payload.old) as { appointment_id?: string; status?: string } | undefined;
      const apptId = row?.appointment_id;
      if (!apptId) return;
      return [
        {
          type: 'patch',
          key: queryKey,
          updater: prev => {
            const list = Array.isArray(prev) ? (prev as AdminAppointment[]) : [];
            return list.map(a =>
              a.id === apptId
                ? { ...a, payment_status: (row?.status as AdminAppointment['payment_status']) ?? a.payment_status }
                : a
            );
          },
        },
        {
          type: 'invalidate',
          keys: [
            keys.payments.byOrg(orgId),
            keys.payments.statsByOrg(orgId),
            keys.stats.admin(orgId),
          ],
        },
      ];
    },
  });

  const updateAppointmentInState = useCallback(
    (appointmentId: string, updatedData: Partial<AdminAppointment>) => {
      queryClient.setQueryData<AdminAppointment[]>(queryKey, prev =>
        (prev ?? []).map(a => (a.id === appointmentId ? { ...a, ...updatedData } : a))
      );
    },
    [queryClient, queryKey]
  );

  return {
    appointments: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    updateAppointmentInState,
  };
}

export function useAdminCleaners() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.cleanerProfiles.byOrg(orgId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('cleaner_profiles')
        .select(`
          id,
          rating,
          total_jobs,
          is_available,
          experience_years,
          hourly_rate,
          background_check_verified,
          insurance_verified,
          payout_percent,
          payout_model,
          payout_configured_at,
          stripe_connect_account_id,
          stripe_connect_onboarding_complete,
          user_profile:user_profiles!id(
            first_name,
            last_name,
            email,
            phone,
            avatar_url
          )
        `)
        .eq('organization_id', orgId)
        .order('total_jobs', { ascending: false });

      if (error) throw error;

      return (data || []).map(cleaner => ({
        ...cleaner,
        user_profile: Array.isArray(cleaner.user_profile)
          ? cleaner.user_profile[0]
          : cleaner.user_profile,
      })) as AdminCleaner[];
    },
  });

  // Org-shared cleaner_profiles channel. Invalidate the list + dependent stats
  // on any change (new cleaner, availability flip, Stripe onboarding flag).
  useSupabaseRealtimeSync({
    channelName: `cleaner_profiles:${orgId}`,
    table: 'cleaner_profiles',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [queryKey, keys.stats.admin(orgId), keys.teamMembers.byOrg(orgId)],
    }),
  });

  const updateCleanerInState = useCallback(
    (cleanerId: string, updatedData: Partial<AdminCleaner>) => {
      queryClient.setQueryData<AdminCleaner[]>(queryKey, prev =>
        (prev ?? []).map(c => (c.id === cleanerId ? { ...c, ...updatedData } : c))
      );
    },
    [queryClient, queryKey]
  );

  return {
    cleaners: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    updateCleanerInState,
  };
}

export function useAdminStats() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';

  const query = useOrgQuery({
    queryKey: keys.stats.admin(orgId),
    queryFn: async ({ orgId }) => {
      // Single RPC round trip (migration 049_dashboard_rpcs.sql, shipped to all envs;
      // the legacy multi-query fallback is gone).
      const rpcRes = await supabase.rpc('admin_dashboard_stats', { p_org_id: orgId });
      if (rpcRes.error) throw rpcRes.error;
      const r = (rpcRes.data ?? {}) as Record<string, number>;
      return {
        totalBookings: Number(r.totalBookings ?? 0),
        activeCleaners: Number(r.activeCleaners ?? 0),
        totalRevenue: Number(r.totalRevenue ?? 0),
        pendingApprovals: Number(r.pendingApprovals ?? 0),
        monthlyGrowth: 15.3, // placeholder; not yet computed in RPC
        completionRate: Number(r.completionRate ?? 0),
        avgRating: Number(r.avgRating ?? 0),
        avgJobsPerDay: Number(r.avgJobsPerDay ?? 0),
        avgJobValue: Number(r.avgJobValue ?? 0),
      } as AdminStats;
    },
  });

  return {
    stats:
      query.data ?? {
        totalBookings: 0,
        activeCleaners: 0,
        totalRevenue: 0,
        pendingApprovals: 0,
        monthlyGrowth: 0,
        completionRate: 0,
        avgRating: 0,
        avgJobsPerDay: 0,
        avgJobValue: 0,
      },
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useAdminPayments() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const query = useOrgQuery({
    queryKey: keys.payments.byOrg(orgId),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id,
          amount,
          status,
          payment_type,
          payment_method,
          charge_kind,
          reference,
          notes,
          paid_at,
          created_at,
          is_self_pay,
          stripe_payment_intent_id,
          refunds:refunds(amount, status),
          appointment:appointments(
            scheduled_date,
            homeowner:user_profiles!homeowner_id(
              first_name,
              last_name
            ),
            service_type:service_types(
              name
            )
          )
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(payment => ({
        ...payment,
        appointment: Array.isArray(payment.appointment)
          ? {
              ...payment.appointment[0],
              homeowner: Array.isArray(payment.appointment[0]?.homeowner)
                ? payment.appointment[0].homeowner[0]
                : payment.appointment[0]?.homeowner,
              service_type: Array.isArray(payment.appointment[0]?.service_type)
                ? payment.appointment[0].service_type[0]
                : payment.appointment[0]?.service_type,
            }
          : payment.appointment,
      })) as AdminPayment[];
    },
  });

  // Refund and chargeback settlements arrive async from Stripe webhooks. Refresh
  // the payments list + stats so a refunded/disputed payment reflects live.
  useSupabaseRealtimeSync({
    channelName: `refunds:${orgId}`,
    table: 'refunds',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.payments.byOrg(orgId), keys.payments.statsByOrg(orgId)],
    }),
  });
  useSupabaseRealtimeSync({
    channelName: `disputes:${orgId}`,
    table: 'disputes',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.payments.byOrg(orgId), keys.payments.statsByOrg(orgId)],
    }),
  });

  return {
    payments: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export interface AdminPayout {
  id: string;
  amount: number;
  // NOTE: the DB also emits 'bank_paid' and 'reversed' at runtime; consumers that
  // render those (redesign Payouts ledger) treat status as a string. The union is
  // kept narrow here so legacy consumers with their own AdminPayout stay assignable.
  status: 'pending' | 'approved' | 'paid' | 'failed';
  /** = cleaner_profiles.id = auth user id. Used by the redesign "Message cleaner" nudge. */
  cleaner_id?: string;
  approved_at?: string;
  paid_at?: string;
  created_at: string;
  notes?: string;
  cleaner: {
    first_name: string;
    last_name: string;
  } | null;
  appointment: {
    scheduled_date: string;
    id: string;
  } | null;
}

export function useAdminPayouts() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const query = useOrgQuery({
    queryKey: keys.payouts.byOrg(orgId),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('payouts')
        .select(`
          id,
          amount,
          status,
          cleaner_id,
          approved_at,
          paid_at,
          created_at,
          notes,
          cleaner:cleaner_profiles!cleaner_id(
            user_profile:user_profiles(
              first_name,
              last_name
            )
          ),
          appointment:appointments(
            id,
            scheduled_date
          )
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(payout => {
        const cleanerData = Array.isArray(payout.cleaner) ? payout.cleaner[0] : payout.cleaner;
        const userProfile = cleanerData?.user_profile;
        const userProfileData = Array.isArray(userProfile) ? userProfile[0] : userProfile;
        return {
          ...payout,
          cleaner: userProfileData || null,
          appointment: Array.isArray(payout.appointment)
            ? payout.appointment[0]
            : payout.appointment,
        };
      }) as AdminPayout[];
    },
  });

  // Payout lifecycle (pending -> approved -> paid -> bank_paid) is driven by
  // approvals + Stripe webhooks. Refresh the payouts list and the payment stats
  // tile (pendingPayouts) so the admin sees status flips without reloading.
  useSupabaseRealtimeSync({
    channelName: `payouts:${orgId}`,
    table: 'payouts',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.payouts.byOrg(orgId), keys.payments.statsByOrg(orgId)],
    }),
  });

  return {
    payouts: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

// --- Paginated (infinite) variants for the redesign Payments screen ---
// Additive: the legacy useAdminPayments/useAdminPayouts above stay untouched
// (the legacy admin + manager dashboards depend on their `byOrg` keys). These
// fetch one page at a time via .range() and return the exact total via
// { count: 'exact' }, so the screen no longer waits on the whole ledger.

const PAYMENTS_INFINITE_SELECT = `
  id,
  amount,
  status,
  payment_type,
  payment_method,
  charge_kind,
  reference,
  notes,
  paid_at,
  created_at,
  is_self_pay,
  stripe_payment_intent_id,
  payment_intent_status,
  refunds:refunds(amount, status),
  appointment:appointments(
    id,
    scheduled_date,
    homeowner:user_profiles!homeowner_id(
      first_name,
      last_name
    ),
    service_type:service_types(
      name
    )
  )
`;

const PAYOUTS_INFINITE_SELECT = `
  id,
  amount,
  status,
  cleaner_id,
  approved_at,
  paid_at,
  created_at,
  notes,
  cleaner:cleaner_profiles!cleaner_id(
    user_profile:user_profiles(
      first_name,
      last_name
    )
  ),
  appointment:appointments(
    id,
    scheduled_date
  )
`;

export function useAdminPaymentsInfinite() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';

  const query = useInfiniteQuery({
    queryKey: keys.payments.infinite(orgId),
    enabled: !!orgId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { from, to } = pageRange(pageParam as number, PAYMENTS_PAGE_SIZE);
      const { data, count, error } = await supabase
        .from('payments')
        .select(PAYMENTS_INFINITE_SELECT, { count: 'exact' })
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const rows = (data || []).map(payment => ({
        ...payment,
        appointment: Array.isArray(payment.appointment)
          ? {
              ...payment.appointment[0],
              homeowner: Array.isArray(payment.appointment[0]?.homeowner)
                ? payment.appointment[0].homeowner[0]
                : payment.appointment[0]?.homeowner,
              service_type: Array.isArray(payment.appointment[0]?.service_type)
                ? payment.appointment[0].service_type[0]
                : payment.appointment[0]?.service_type,
            }
          : payment.appointment,
      })) as AdminPayment[];

      return { rows, count: count ?? 0 };
    },
    getNextPageParam: (lastPage, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return nextPageParam(loaded, lastPage.count, all.length);
    },
  });

  useSupabaseRealtimeSync({
    channelName: `payments-inf-refunds:${orgId}`,
    table: 'refunds',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.payments.infinite(orgId), keys.payments.statsByOrg(orgId)],
    }),
  });
  useSupabaseRealtimeSync({
    channelName: `payments-inf-disputes:${orgId}`,
    table: 'disputes',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.payments.infinite(orgId), keys.payments.statsByOrg(orgId)],
    }),
  });
  // Direct payments-table sub: charges land async from Stripe webhooks, so a new
  // paid charge (or status flip) refreshes the paginated list + the KPI tiles.
  // Distinct channel name so it never dedupes against the legacy byOrg subs.
  useSupabaseRealtimeSync({
    channelName: `payments-inf:${orgId}`,
    table: 'payments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.payments.infinite(orgId), keys.payments.statsByOrg(orgId)],
    }),
  });

  const rows = query.data?.pages.flatMap(p => p.rows) ?? [];
  const total = query.data?.pages?.[0]?.count ?? 0;

  return {
    rows,
    total,
    hasMore: !!query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useAdminPayoutsInfinite() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';

  const query = useInfiniteQuery({
    queryKey: keys.payouts.infinite(orgId),
    enabled: !!orgId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { from, to } = pageRange(pageParam as number, PAYMENTS_PAGE_SIZE);
      const { data, count, error } = await supabase
        .from('payouts')
        .select(PAYOUTS_INFINITE_SELECT, { count: 'exact' })
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const rows = (data || []).map(payout => {
        const cleanerData = Array.isArray(payout.cleaner) ? payout.cleaner[0] : payout.cleaner;
        const userProfile = cleanerData?.user_profile;
        const userProfileData = Array.isArray(userProfile) ? userProfile[0] : userProfile;
        return {
          ...payout,
          cleaner: userProfileData || null,
          appointment: Array.isArray(payout.appointment)
            ? payout.appointment[0]
            : payout.appointment,
        };
      }) as AdminPayout[];

      return { rows, count: count ?? 0 };
    },
    getNextPageParam: (lastPage, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return nextPageParam(loaded, lastPage.count, all.length);
    },
  });

  useSupabaseRealtimeSync({
    channelName: `payouts-inf:${orgId}`,
    table: 'payouts',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.payouts.infinite(orgId), keys.payments.statsByOrg(orgId)],
    }),
  });

  const rows = query.data?.pages.flatMap(p => p.rows) ?? [];
  const total = query.data?.pages?.[0]?.count ?? 0;

  return {
    rows,
    total,
    hasMore: !!query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export interface AdminInvoice {
  id: string;
  invoice_number: string;
  amount: number;
  status: 'draft' | 'sent' | 'paid' | 'cancelled';
  due_date?: string;
  paid_at?: string;
  created_at: string;
  notes?: string;
  homeowner: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

export function useAdminInvoices() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const query = useOrgQuery({
    queryKey: keys.invoices.byOrg(orgId),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          amount,
          status,
          due_date,
          paid_at,
          created_at,
          notes,
          homeowner:user_profiles!homeowner_id(
            first_name,
            last_name,
            email
          )
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(invoice => ({
        ...invoice,
        homeowner: Array.isArray(invoice.homeowner)
          ? invoice.homeowner[0]
          : invoice.homeowner,
      })) as AdminInvoice[];
    },
  });

  // Invoice status (draft -> sent -> paid) and amount edits should reflect live
  // across tabs / staff.
  useSupabaseRealtimeSync({
    channelName: `invoices:${orgId}`,
    table: 'invoices',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [keys.invoices.byOrg(orgId)] }),
  });

  return {
    invoices: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export interface PaymentStats {
  totalRevenue: number;
  pendingPayouts: number;
  thisMonthRevenue: number;
}

export function usePaymentStats() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';

  const query = useOrgQuery({
    queryKey: keys.payments.statsByOrg(orgId),
    queryFn: async ({ orgId }) => {
      // Single RPC round trip (migration 049_dashboard_rpcs.sql, shipped to all envs;
      // the legacy multi-query fallback is gone).
      const rpcRes = await supabase.rpc('payment_stats', { p_org_id: orgId });
      if (rpcRes.error) throw rpcRes.error;
      const r = (rpcRes.data ?? {}) as Record<string, number>;
      return {
        totalRevenue: Number(r.totalRevenue ?? 0),
        pendingPayouts: Number(r.pendingPayouts ?? 0),
        thisMonthRevenue: Number(r.thisMonthRevenue ?? 0),
      } as PaymentStats;
    },
  });

  return {
    stats: query.data ?? { totalRevenue: 0, pendingPayouts: 0, thisMonthRevenue: 0 },
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

/**
 * A chargeback/dispute row (Stripe `charge.dispute.*`), joined to the payment it
 * hit and that payment's appointment context (payer + service) so the operator
 * surface can show who/what/how-much without a second fetch. `amount` is CENTS
 * (bigint from Stripe), unlike `AdminPayment.amount` which is dollars.
 */
export interface AdminDispute {
  id: string;
  /** Disputed amount in CENTS (Stripe `dispute.amount`). */
  amount: number;
  /** Stripe dispute status: needs_response | warning_needs_response | under_review |
   *  warning_under_review | warning_closed | won | lost | prevented. Untyped string
   *  because the webhook writes it through verbatim. */
  status: string;
  /** Stripe dispute reason (e.g. 'fraudulent', 'product_not_received'), or null. */
  reason: string | null;
  /** Evidence submission deadline; null until Stripe sets one. */
  evidence_due_by: string | null;
  created_at: string;
  updated_at?: string;
  payment_id: string | null;
  stripe_dispute_id: string;
  stripe_charge_id: string;
  payment: {
    id: string;
    /** Payment amount in DOLLARS. */
    amount: number;
    payment_method?: string;
    is_self_pay?: boolean;
    appointment: {
      scheduled_date: string;
      homeowner_id: string | null;
      homeowner: { first_name: string; last_name: string } | null;
      service_type: { name: string } | null;
    } | null;
  } | null;
}

const DISPUTES_SELECT = `
  id,
  amount,
  status,
  reason,
  evidence_due_by,
  created_at,
  updated_at,
  payment_id,
  stripe_dispute_id,
  stripe_charge_id,
  payment:payments(
    id,
    amount,
    payment_method,
    is_self_pay,
    appointment:appointments(
      scheduled_date,
      homeowner_id,
      homeowner:user_profiles!homeowner_id(
        first_name,
        last_name
      ),
      service_type:service_types(
        name
      )
    )
  )
`;

/**
 * Chargebacks for the org. Low-volume, so a plain (non-infinite) org query.
 * The webhook (dispatchStripeEvent) is the only writer; RLS lets owner/admin/manager
 * read. Ordered soonest-deadline-first so the response window is front-and-center.
 * Owns its own realtime channel (distinct from the two payments-list disputes subs,
 * which only invalidate payments keys) so a new/updated dispute refreshes THIS list.
 */
export function useAdminDisputes() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';

  const query = useOrgQuery({
    queryKey: keys.disputes.byOrg(orgId),
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('disputes')
        .select(DISPUTES_SELECT)
        .eq('organization_id', orgId)
        .order('evidence_due_by', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(dispute => {
        const payment = Array.isArray(dispute.payment) ? dispute.payment[0] : dispute.payment;
        const appointment = payment
          ? Array.isArray(payment.appointment)
            ? payment.appointment[0]
            : payment.appointment
          : null;
        return {
          ...dispute,
          payment: payment
            ? {
                ...payment,
                appointment: appointment
                  ? {
                      ...appointment,
                      homeowner: Array.isArray(appointment.homeowner)
                        ? appointment.homeowner[0]
                        : appointment.homeowner,
                      service_type: Array.isArray(appointment.service_type)
                        ? appointment.service_type[0]
                        : appointment.service_type,
                    }
                  : null,
              }
            : null,
        };
      }) as AdminDispute[];
    },
  });

  useSupabaseRealtimeSync({
    channelName: `disputes-list:${orgId}`,
    table: 'disputes',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [keys.disputes.byOrg(orgId)],
    }),
  });

  return {
    disputes: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useAdminMessages() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const query = useOrgQuery({
    queryKey: ['messages', 'admin', orgId] as const,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id,
          subject,
          content,
          is_read,
          created_at,
          appointment_id,
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
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map(message => ({
        ...message,
        sender: Array.isArray(message.sender) ? message.sender[0] : message.sender,
        recipient: Array.isArray(message.recipient)
          ? message.recipient[0]
          : message.recipient,
      })) as AdminMessage[];
    },
  });

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// Helper function to update appointment status
export async function updateAppointmentStatus(appointmentId: string, status: string) {
  try {
    const { error } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', appointmentId);

    if (error) throw error;

    // If status changed to 'completed', trigger automatic payment
    if (status === 'completed') {
      try {
        // Get appointment details for organization_id
        const { data: appointment } = await supabase
          .from('appointments')
          .select('organization_id')
          .eq('id', appointmentId)
          .single();

        // New charge flow: charge the saved card now that the job is complete. Non-fatal; a payment
        // problem surfaces in "Payments needing attention" for follow-up.
        const result = await chargeCompletedAppointmentClient(appointmentId, appointment?.organization_id);
        return { success: true, ...result };
      } catch (paymentError) {
        // Don't fail the status update, just log the payment error
        return { 
          success: true, 
          paymentStatus: 'failed',
          paymentError: paymentError instanceof Error ? paymentError.message : 'Payment processing failed'
        };
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update appointment' };
  }
}

// Helper function to update a full appointment
export async function updateAppointment(
  appointmentId: string,
  data: {
    scheduled_date?: string;
    scheduled_time?: string;
    service_type_id?: string;
    checklist_id?: string | null;
    property_id?: string;
    cleaner_id?: string | null;
    total_price?: number;
    price_override_enabled?: boolean;
    price_override_total?: number | null;
    special_requests?: string | null;
    notes?: string | null;
    status?: string;
    cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected';
    /** Wave 2 SLA: ISO timestamp by which the cleaner must respond, or null
        once they have. Callers compute this via computeResponseDeadlineISO. */
    response_deadline?: string | null;
  }
): Promise<{ success: boolean; data?: AdminAppointment; error?: string }> {
  try {
    const { error, data: updateData } = await supabase
      .from('appointments')
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .eq('id', appointmentId)
      .select(`
        id,
        service_type_id,
        checklist_id,
        scheduled_date,
        scheduled_time,
        status,
        total_price,
        special_requests,
        notes,
        series_id,
        cleaner_confirmation_status,
        price_override_enabled,
        price_override_total,
        homeowner:user_profiles!homeowner_id(
          first_name,
          last_name,
          email
        ),
        cleaner_profile:cleaner_profiles(
          user_profile:user_profiles!id(
            id,
            first_name,
            last_name,
            email
          )
        ),
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
        )
      `)
      .single();

    if (error) {
      throw error;
    }
    
    if (!updateData) {
      return { success: false, error: 'No rows were updated. This may be due to RLS policies.' };
    }
    
    // Transform the data to match our interface
    const transformedData = {
      ...updateData,
      homeowner: Array.isArray(updateData.homeowner) ? updateData.homeowner[0] : updateData.homeowner,
      property: Array.isArray(updateData.property) ? updateData.property[0] : updateData.property,
      service_type: Array.isArray(updateData.service_type) ? updateData.service_type[0] : updateData.service_type,
      checklist: Array.isArray(updateData.checklist) ? updateData.checklist[0] : updateData.checklist,
      cleaner_profile: updateData.cleaner_profile && Array.isArray(updateData.cleaner_profile) 
        ? {
            ...updateData.cleaner_profile[0],
            user_profile: Array.isArray(updateData.cleaner_profile[0]?.user_profile) 
              ? updateData.cleaner_profile[0].user_profile[0] 
              : updateData.cleaner_profile[0]?.user_profile
          }
        : updateData.cleaner_profile
    };
    
    return { success: true, data: transformedData as AdminAppointment };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update appointment' };
  }
}

// Helper function to assign cleaner to appointment
export async function assignCleanerToAppointment(appointmentId: string, cleanerId: string) {
  try {
    const { error } = await supabase
      .from('appointments')
      .update({ 
        cleaner_id: cleanerId,
        status: 'pending',
        cleaner_confirmation_status: 'awaiting'
      })
      .eq('id', appointmentId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to assign cleaner' };
  }
}

// Helper function to delete a cleaner
export async function deleteCleaner(cleanerId: string) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`/api/admin/delete-cleaner?id=${encodeURIComponent(cleanerId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: session?.access_token ? `Bearer ${session.access_token}` : '',
      },
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { 
        success: false, 
        error: data.error || 'Failed to delete cleaner' 
      };
    }

    return { success: true, message: data.message };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete cleaner' 
    };
  }
}

// Helper function to cancel an appointment (soft delete - changes status to cancelled)
export async function cancelAppointment(appointmentId: string) {
  try {
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointmentId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to cancel appointment' };
  }
}

// Helper function to permanently delete an appointment (hard delete).
// Uses .select() so we can detect when RLS allows 0 rows (no error but nothing deleted).
export async function deleteAppointment(appointmentId: string) {
  try {
    const { data, error } = await supabase
      .from("appointments")
      .delete()
      .eq("id", appointmentId)
      .select("id");

    if (error) {
      throw error;
    }

    // If no row was returned, RLS blocked the delete (0 rows affected).
    if (!data || data.length === 0) {
      return {
        success: false,
        error:
          "You don't have permission to delete this appointment, or it no longer exists.",
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete appointment",
    };
  }
}

// ==========================================
// CUSTOMER (HOMEOWNER) MANAGEMENT
// ==========================================

export interface AdminCustomer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  properties_count: number;
  appointments_count: number;
  total_spent: number;
  last_appointment_date: string | null;
}

export interface CustomerAppointment {
  id: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  service_type: {
    name: string;
  } | null;
  checklist?: {
    name: string;
    price_adder?: number;
  } | null;
  property: {
    name: string;
    address: string;
  } | null;
}

export interface CustomerProperty {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  photo_url?: string | null;
}

export function useAdminCustomers() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.customers.byOrg(orgId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId }) => {
      // Single RPC round trip (migration 049_dashboard_rpcs.sql, shipped to all envs;
      // the legacy 4-query parallel + lossy client merge is gone).
      const rpcRes = await supabase.rpc('org_customers_with_counts', { p_org_id: orgId });
      if (rpcRes.error) throw rpcRes.error;
      return ((rpcRes.data ?? []) as Array<Record<string, unknown>>).map(row => ({
        id: row.id as string,
        first_name: (row.first_name ?? null) as string | null,
        last_name: (row.last_name ?? null) as string | null,
        email: row.email as string,
        phone: (row.phone ?? null) as string | null,
        avatar_url: (row.avatar_url ?? null) as string | null,
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
        properties_count: Number(row.properties_count ?? 0),
        appointments_count: Number(row.appointments_count ?? 0),
        total_spent: Number(row.total_spent ?? 0),
        last_appointment_date: (row.last_appointment_date ?? null) as string | null,
      })) as AdminCustomer[];
    },
  });

  const updateCustomerInState = useCallback(
    (customerId: string, updatedData: Partial<AdminCustomer>) => {
      queryClient.setQueryData<AdminCustomer[]>(queryKey, prev =>
        (prev ?? []).map(c => (c.id === customerId ? { ...c, ...updatedData } : c))
      );
    },
    [queryClient, queryKey]
  );

  return {
    customers: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    updateCustomerInState,
  };
}

export function useCustomerDetails(customerId: string | null) {
  const query = useOrgQuery({
    queryKey: keys.customers.detail(customerId ?? ''),
    enabled: !!customerId,
    queryFn: async ({ orgId }) => {
      const [appointmentsRes, propertiesRes] = await Promise.all([
        supabase
          .from('appointments')
          .select(`
            id,
            service_type_id,
            checklist_id,
            scheduled_date,
            scheduled_time,
            status,
            total_price,
            service_type:service_types(name),
            checklist:checklists(name, price_adder),
            property:properties(name, address)
          `)
          .eq('organization_id', orgId)
          .eq('homeowner_id', customerId as string)
          .order('scheduled_date', { ascending: false }),
        supabase
          .from('properties')
          .select(`
            id,
            name,
            address,
            city,
            state,
            zip_code,
            bedrooms,
            bathrooms,
            square_feet
          `)
          .eq('organization_id', orgId)
          .eq('owner_id', customerId as string)
          .is('archived_at', null)
          .order('created_at', { ascending: false }),
      ]);

      if (appointmentsRes.error) throw appointmentsRes.error;
      if (propertiesRes.error) throw propertiesRes.error;

      const appointments = (appointmentsRes.data || []).map(apt => ({
        ...apt,
        service_type: Array.isArray(apt.service_type) ? apt.service_type[0] : apt.service_type,
        checklist: Array.isArray(apt.checklist) ? apt.checklist[0] : apt.checklist,
        property: Array.isArray(apt.property) ? apt.property[0] : apt.property,
      })) as CustomerAppointment[];

      return {
        appointments,
        properties: (propertiesRes.data || []) as CustomerProperty[],
      };
    },
  });

  return {
    appointments: query.data?.appointments ?? [],
    properties: query.data?.properties ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

// Helper function to update a customer profile
export async function updateCustomer(
  customerId: string, 
  data: { first_name?: string; last_name?: string; email?: string; phone?: string }
): Promise<{ success: boolean; data?: AdminCustomer; error?: string }> {
  try {
    const { error, data: updateData } = await supabase
      .from('user_profiles')
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .eq('id', customerId)
      .select('id, first_name, last_name, email, phone, created_at')
      .single();

    if (error) {
      throw error;
    }
    
    if (!updateData) {
      return { success: false, error: 'No rows were updated. This may be due to RLS policies.' };
    }
    
    // Return full customer data
    return { 
      success: true, 
      data: updateData as AdminCustomer 
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update customer' };
  }
}

// Per-customer outcome from the hard-delete route.
export interface DeleteCustomerResult {
  id: string;
  status: 'deleted' | 'blocked' | 'error';
  reason?: string;
}

// Hard-delete customers via the server route (removes org membership, any
// pending invite, the user_profile, and the auth user for a clean account;
// customers with booking/invoice history are blocked, not deleted). The route
// processes the batch sequentially server-side, so a bulk delete is one request
// (not N concurrent client deletes, which previously saturated the pool).
export async function deleteCustomers(customerIds: string[], organizationId: string) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch('/api/admin/delete-customer', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: session?.access_token ? `Bearer ${session.access_token}` : '',
      },
      body: JSON.stringify({ organizationId, customerIds }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { success: false as const, error: data.error || 'Failed to delete customers' };
    }

    return { success: true as const, results: (data.results ?? []) as DeleteCustomerResult[] };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Failed to delete customers',
    };
  }
}

// Single-customer convenience wrapper over the batch route.
export async function deleteCustomer(customerId: string, organizationId: string) {
  const result = await deleteCustomers([customerId], organizationId);
  if (!result.success) return result;
  const item = result.results?.[0];
  if (!item || item.status !== 'deleted') {
    return { success: false as const, error: item?.reason || 'Customer could not be deleted' };
  }
  return { success: true as const };
}

// ==========================================
// PROPERTY MANAGEMENT
// ==========================================

export interface AdminProperty {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  photo_url?: string | null;
  archived_at?: string | null;
  special_instructions: string | null;
  access_instructions: string | null;
  created_at: string;
  updated_at: string;
  owner_id: string;
  homeowner: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

export function useAdminProperties() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.properties.byOrg(orgId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('properties')
        .select(`
          id,
          name,
          address,
          city,
          state,
          zip_code,
          bedrooms,
          bathrooms,
          square_feet,
          photo_url,
          special_instructions,
          access_instructions,
          created_at,
          updated_at,
          owner_id,
          homeowner:user_profiles!owner_id(
            id,
            first_name,
            last_name,
            email
          )
        `)
        .eq('organization_id', orgId)
        .is('archived_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(property => ({
        ...property,
        homeowner: Array.isArray(property.homeowner)
          ? property.homeowner[0]
          : property.homeowner,
      })) as AdminProperty[];
    },
  });

  // Org-shared properties channel. New properties / edits / deletes ripple
  // into customer property counts too.
  useSupabaseRealtimeSync({
    channelName: `properties:${orgId}`,
    table: 'properties',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [queryKey, keys.customers.byOrg(orgId)],
    }),
  });

  const updatePropertyInState = useCallback(
    (propertyId: string, updatedData: Partial<AdminProperty>) => {
      queryClient.setQueryData<AdminProperty[]>(queryKey, prev =>
        (prev ?? []).map(p => (p.id === propertyId ? { ...p, ...updatedData } : p))
      );
    },
    [queryClient, queryKey]
  );

  return {
    properties: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    updatePropertyInState,
  };
}

// Helper function to update a property
export async function updateProperty(
  propertyId: string,
  data: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    bedrooms?: number | null;
    bathrooms?: number | null;
    square_feet?: number | null;
    photo_url?: string | null;
    special_instructions?: string | null;
    access_instructions?: string | null;
    owner_id?: string | null;
  }
): Promise<{ success: boolean; data?: AdminProperty; error?: string }> {
  try {
    const { error, data: updateData } = await supabase
      .from('properties')
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .eq('id', propertyId)
      .select(`
        id,
        name,
        address,
        city,
        state,
        zip_code,
        bedrooms,
        bathrooms,
        square_feet,
        photo_url,
        special_instructions,
        access_instructions,
        created_at,
        updated_at,
        owner_id,
        homeowner:user_profiles!owner_id(
          id,
          first_name,
          last_name,
          email
        )
      `)
      .single();

    if (error) {
      throw error;
    }
    
    if (!updateData) {
      return { success: false, error: 'No rows were updated. This may be due to RLS policies.' };
    }
    
    // Transform homeowner if it's an array
    const transformedData = {
      ...updateData,
      homeowner: Array.isArray(updateData.homeowner) ? updateData.homeowner[0] : updateData.homeowner
    };
    
    return { success: true, data: transformedData as AdminProperty };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update property' };
  }
}

// Helper function to delete a property
export async function deleteProperty(propertyId: string, organizationId: string) {
  try {
    // Verify the property belongs to this organization. Both homeowner-owned and org-owned
    // (owner_id IS NULL) properties carry organization_id, so scope by that, not by homeowner
    // membership (which excludes org-owned properties). RLS enforces the actual delete permission.
    const { data: property, error: checkError } = await supabase
      .from('properties')
      .select('organization_id')
      .eq('id', propertyId)
      .single();

    if (checkError) throw checkError;

    if (!property || property.organization_id !== organizationId) {
      return { success: false, error: 'Property not found or does not belong to this organization' };
    }

    // Delete the property
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', propertyId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete property' };
  }
}

export async function countPropertyAppointments(propertyId: string) {
  const [{ count: live }, { count: history }] = await Promise.all([
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).in('status', LIVE_APPT_STATUSES as unknown as string[]),
    supabase.from('appointments').select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId).in('status', HISTORY_APPT_STATUSES as unknown as string[]),
  ]);
  return { liveCount: live ?? 0, historyCount: history ?? 0 };
}

/**
 * Delete a property safely (R4). Never-booked → hard delete. Any history →
 * cancel live cleanings + stop active recurring series, then archive (soft-delete)
 * so completed/cancelled records still resolve. Returns the action taken.
 */
export async function archiveOrDeleteProperty(propertyId: string, organizationId: string) {
  try {
    const { data: property, error: checkError } = await supabase
      .from('properties').select('organization_id').eq('id', propertyId).single();
    if (checkError) throw checkError;
    if (!property || property.organization_id !== organizationId) {
      return { success: false, error: 'Property not found or does not belong to this organization' };
    }
    const { liveCount, historyCount } = await countPropertyAppointments(propertyId);
    const plan = planPropertyDeletion({ liveCount, historyCount });

    if (plan.action === 'hard-delete') {
      const { error } = await supabase.from('properties').delete().eq('id', propertyId);
      if (error) throw error;
      return { success: true, action: plan.action };
    }
    if (plan.action === 'cancel-and-archive') {
      const { error: cancelErr } = await supabase.from('appointments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('property_id', propertyId).in('status', LIVE_APPT_STATUSES as unknown as string[]);
      if (cancelErr) throw cancelErr;
    }
    // Stop any active recurring series before archiving, for BOTH archive paths
    // (archive-only and cancel-and-archive). Idempotent: matches 0 rows when none
    // is active. This also closes the gap where a mid-sequence failure + retry
    // re-plans as archive-only (live cleanings already cancelled) and would
    // otherwise leave a stranded active series that can regenerate appointments
    // on an archived property.
    const { error: seriesErr } = await supabase.from('recurring_appointment_series')
      .update({ is_active: false }).eq('property_id', propertyId).eq('is_active', true);
    if (seriesErr) throw seriesErr;
    const { error: archiveErr } = await supabase.from('properties')
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', propertyId);
    if (archiveErr) throw archiveErr;
    return { success: true, action: plan.action };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete property' };
  }
}

// Helper function to delete multiple properties
export async function deleteProperties(propertyIds: string[], organizationId: string) {
  try {
    // Scope by organization_id so org-owned properties (owner_id IS NULL) are deletable too,
    // not just homeowner-owned ones. RLS enforces the actual delete permission.
    const { data: properties, error: checkError } = await supabase
      .from('properties')
      .select('id, organization_id')
      .in('id', propertyIds);

    if (checkError) throw checkError;

    if (!properties) {
      return { success: false, error: 'Properties not found' };
    }

    // Filter to only delete properties that belong to this organization
    const validPropertyIds = properties
      .filter(p => p.organization_id === organizationId)
      .map(p => p.id);

    if (validPropertyIds.length === 0) {
      return { success: false, error: 'No valid properties found to delete' };
    }

    // Delete the properties
    const { error } = await supabase
      .from('properties')
      .delete()
      .in('id', validPropertyIds);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete properties' };
  }
}

// ==========================================
// TEAM MEMBERS MANAGEMENT (CLEANERS & MANAGERS)
// ==========================================

export interface TeamMember {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    avatar_url: string | null;
  } | null;
  role: 'cleaner' | 'manager' | 'admin';
  // Cleaner-specific fields
  cleaner_profile?: {
    rating: number;
    total_jobs: number;
    is_available: boolean;
  } | null;
  // Manager-specific fields
  permissions?: ManagerPermissions | null;
}

export function useAdminTeamMembers() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchTeamMembers = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);

      // Get all cleaners and managers from organization_members
      const { data: orgMembers, error: membersError } = await supabase
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', currentOrganizationId)
        .in('role', ['cleaner', 'manager', 'admin']);

      if (membersError) throw membersError;

      if (!orgMembers || orgMembers.length === 0) {
        setTeamMembers([]);
        setLoading(false);
        return;
      }

      const userIds = orgMembers.map(m => m.user_id);
      const cleanerIds = orgMembers.filter(m => m.role === 'cleaner').map(m => m.user_id);
      const managerIds = orgMembers.filter(m => m.role === 'manager').map(m => m.user_id);

      // Get user profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, phone, avatar_url')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      // Get cleaner profiles
      const { data: cleanerProfiles, error: cleanerError } = await supabase
        .from('cleaner_profiles')
        .select('id, rating, total_jobs, is_available')
        .in('id', cleanerIds)
        .eq('organization_id', currentOrganizationId);

      if (cleanerError) throw cleanerError;

      // Get manager permissions
      const { data: managerPermissionsRaw, error: permissionsError } = await supabase
        .from('manager_permissions')
        .select(`manager_id, ${MANAGER_FLAG_SELECT}`)
        .in('manager_id', managerIds)
        .eq('organization_id', currentOrganizationId);

      if (permissionsError) throw permissionsError;

      // The dynamic (non-literal) select string above defeats postgrest-js's
      // type-level column parser, so cast through `unknown` before touching
      // any fields (same idiom as useAdminStaff below).
      const managerPermissions = (managerPermissionsRaw as unknown as Array<Record<string, unknown>> | null) ?? [];

      // Combine all data
      const teamMembersData: TeamMember[] = orgMembers.map(member => {
        const profile = profiles?.find(p => p.id === member.user_id);
        const cleanerProfile = member.role === 'cleaner'
          ? cleanerProfiles?.find(cp => cp.id === member.user_id)
          : null;
        const permissions = member.role === 'manager'
          ? managerPermissions.find(mp => mp.manager_id === member.user_id)
          : null;

        return {
          id: member.user_id,
          user_profile: profile ? {
            first_name: profile.first_name || '',
            last_name: profile.last_name || '',
            email: profile.email || '',
            phone: profile.phone,
            avatar_url: profile.avatar_url,
          } : null,
          role: member.role as 'cleaner' | 'manager',
          cleaner_profile: cleanerProfile ? {
            rating: Number(cleanerProfile.rating) || 0,
            total_jobs: cleanerProfile.total_jobs || 0,
            is_available: cleanerProfile.is_available || false,
          } : null,
          permissions: permissions ? coerceManagerPermissions(permissions) : null,
        };
      });

      setTeamMembers(teamMembersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch team members');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchTeamMembers();
  }, [fetchTeamMembers]);

  // Org-scoped realtime — re-fetch the (multi-table) team list whenever any of
  // the contributing tables changes. We pass `fetchTeamMembers` directly; the
  // helper holds it in a ref so the callback always sees the latest version.
  const orgId = currentOrganizationId ?? '';
  useSupabaseRealtimeSync({
    channelName: `organization_members:${orgId}`,
    table: 'organization_members',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => {
      fetchTeamMembers();
    },
  });
  useSupabaseRealtimeSync({
    channelName: `manager_permissions:${orgId}`,
    table: 'manager_permissions',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => {
      fetchTeamMembers();
    },
  });

  const refetch = useCallback(() => {
    fetchTeamMembers();
  }, [fetchTeamMembers]);

  // Update a single team member in state without refetching
  const updateTeamMemberInState = useCallback((memberId: string, updatedData: Partial<TeamMember>) => {
    setTeamMembers(prevMembers => 
      prevMembers.map(member => 
        member.id === memberId 
          ? { ...member, ...updatedData }
          : member
      )
    );
  }, []);

  return { teamMembers, loading, error, refetch, updateTeamMemberInState };
}

// Helper function to update manager permissions
export async function updateManagerPermissions(
  managerId: string,
  organizationId: string,
  permissions: ManagerPermissions
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch('/api/admin/update-manager-permissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: session?.access_token ? `Bearer ${session.access_token}` : '',
      },
      body: JSON.stringify({
        managerId,
        organizationId,
        ...permissions,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Failed to update manager permissions',
      };
    }

    return { success: true, message: data.message };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update manager permissions',
    };
  }
}

// Helper function to delete a team member
export async function deleteTeamMember(userId: string, organizationId: string) {
  try {
    const response = await fetch(`/api/admin/delete-team-member`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, organizationId }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Failed to delete team member',
      };
    }

    return { success: true, message: data.message };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete team member',
    };
  }
}


// Helper function to invite a team member
export async function inviteTeamMember(data: {
  email: string;
  role: 'cleaner' | 'manager' | 'admin' | 'homeowner';
  organizationId: string;
  accessToken: string | null | undefined;
  permissions?: ManagerPermissions;
}) {
  try {

    const { accessToken, ...rest } = data;

    const response = await fetch('/api/admin/send-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': accessToken ? `Bearer ${accessToken}` : '',
      },
      body: JSON.stringify(rest),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Failed to invite team member',
      };
    }

    return { success: true, data: result.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to invite team member',
    };
  }
}

// Client helper: admin one-click accepts a cleaner-suggested counter-proposal.
// Posts to /api/appointments/accept-counter-proposal with the picked
// suggested-time row id. The route updates the appointment to confirmed at
// the picked date/time and clears the feedback.
export async function acceptCounterProposal(args: {
  appointmentId: string;
  suggestedTimeId: string;
  organizationId: string;
  accessToken: string | null | undefined;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { accessToken, ...rest } = args;
    const response = await fetch('/api/appointments/accept-counter-proposal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken ? `Bearer ${accessToken}` : '',
      },
      body: JSON.stringify(rest),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      return { success: false, error: result.error || 'Failed to accept counter-proposal' };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to accept counter-proposal',
    };
  }
}

// Client helper: ping the assigned cleaner's notification bell that their job
// was rescheduled and needs re-confirmation. Posts to
// /api/appointments/notify-reschedule. Best-effort — the route resolves the
// cleaner from the appointment and writes a notification_events row; failures
// are swallowed so the reschedule UI still completes.
export async function notifyReschedule(args: {
  appointmentId: string;
  organizationId: string;
  accessToken: string | null | undefined;
}): Promise<void> {
  try {
    const { accessToken, ...rest } = args;
    await fetch('/api/appointments/notify-reschedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken ? `Bearer ${accessToken}` : '',
      },
      body: JSON.stringify(rest),
    });
  } catch (err) {
    console.error('Error notifying cleaner of reschedule:', err);
  }
}

// ---------------------------------------------------------------------------
// Operator "Cleaners & team" screen (redesign): per-cleaner scorecard roster,
// lazy workload/payouts, and the edit/bench/cancel-invite mutations. The
// roster is one round trip via the cleaner_scorecard(p_org_id) RPC (migration
// 091); never trusts cleaner_profiles.rating / total_jobs (those are never
// written) - all counts are derived from appointments by the RPC.
// ---------------------------------------------------------------------------

/** One row of the cleaner_scorecard RPC: profile + derived aggregates. */
export interface AdminCleanerScorecard {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  payout_percent: number;
  /** Unified pay mode ('percentage' | 'flat' | 'request' | 'hourly_external'). */
  payout_model: string;
  flat_rate_cents: number | null;
  /** NULL = no pay decision was ever made for this cleaner ("Pay not set"). */
  payout_configured_at: string | null;
  hourly_rate: number | null;
  experience_years: number | null;
  bio: string | null;
  is_available: boolean;
  background_check_verified: boolean;
  insurance_verified: boolean;
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: boolean;
  deactivated_at: string | null;
  created_at: string;
  total_jobs: number;
  completed_jobs: number;
  cancelled_jobs: number;
  upcoming_jobs: number;
  upcoming_this_week: number;
  completed_this_week: number;
  cleaner_earnings: number;
  owed_now: number;
  payouts_failed_count: number;
}

export function useAdminCleanerScorecards() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.cleanerProfiles.scorecards(orgId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase.rpc('cleaner_scorecard', { p_org_id: orgId });
      if (error) throw error;
      return ((data as Array<Record<string, unknown>>) ?? []).map((row) => ({
        id: row.id as string,
        first_name: (row.first_name ?? null) as string | null,
        last_name: (row.last_name ?? null) as string | null,
        email: row.email as string,
        phone: (row.phone ?? null) as string | null,
        avatar_url: (row.avatar_url ?? null) as string | null,
        payout_percent: Number(row.payout_percent ?? 0),
        payout_model: (row.payout_model as string | null) ?? 'percentage',
        flat_rate_cents: row.flat_rate_cents == null ? null : Number(row.flat_rate_cents),
        // Deliberately NO fallback to a configured state: a missing column must read
        // as unconfigured and be loud, never as configured and silent.
        payout_configured_at: (row.payout_configured_at ?? null) as string | null,
        hourly_rate: row.hourly_rate == null ? null : Number(row.hourly_rate),
        experience_years: row.experience_years == null ? null : Number(row.experience_years),
        bio: (row.bio ?? null) as string | null,
        is_available: Boolean(row.is_available),
        background_check_verified: Boolean(row.background_check_verified),
        insurance_verified: Boolean(row.insurance_verified),
        stripe_connect_account_id: (row.stripe_connect_account_id ?? null) as string | null,
        stripe_connect_onboarding_complete: Boolean(row.stripe_connect_onboarding_complete),
        deactivated_at: (row.deactivated_at ?? null) as string | null,
        created_at: row.created_at as string,
        total_jobs: Number(row.total_jobs ?? 0),
        completed_jobs: Number(row.completed_jobs ?? 0),
        cancelled_jobs: Number(row.cancelled_jobs ?? 0),
        upcoming_jobs: Number(row.upcoming_jobs ?? 0),
        upcoming_this_week: Number(row.upcoming_this_week ?? 0),
        completed_this_week: Number(row.completed_this_week ?? 0),
        cleaner_earnings: Number(row.cleaner_earnings ?? 0),
        owed_now: Number(row.owed_now ?? 0),
        payouts_failed_count: Number(row.payouts_failed_count ?? 0),
      })) as AdminCleanerScorecard[];
    },
  });

  // Refresh on profile/bench edits. Job/payout-driven scorecard changes refresh
  // on the next staleTime/refetch (the container refetches after its mutations).
  useSupabaseRealtimeSync({
    channelName: `cleaner_scorecards:${orgId}`,
    table: 'cleaner_profiles',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const updateCleanerInState = useCallback(
    (cleanerId: string, updatedData: Partial<AdminCleanerScorecard>) => {
      queryClient.setQueryData<AdminCleanerScorecard[]>(queryKey, (prev) =>
        (prev ?? []).map((c) => (c.id === cleanerId ? { ...c, ...updatedData } : c)),
      );
    },
    [queryClient, queryKey],
  );

  return {
    cleaners: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
    updateCleanerInState,
  };
}

export interface CleanerUpcomingJob {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  service: string;
  property: string | null;
  total_price: number;
}

/** Lazy detail load for the cleaner Sheet: the cleaner's upcoming jobs. (Owed /
 *  failed payout figures come from the scorecard RPC, so we don't refetch
 *  payout rows here.) */
export function useCleanerWorkload(cleanerId: string | null) {
  const query = useOrgQuery({
    queryKey: keys.cleanerProfiles.detail(cleanerId ?? ''),
    enabled: !!cleanerId,
    queryFn: async ({ orgId }) => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, scheduled_date, scheduled_time, status, total_price,
          service_type:service_types(name),
          property:properties(name, address)
        `)
        .eq('organization_id', orgId)
        .eq('cleaner_id', cleanerId as string)
        .in('status', ['pending', 'confirmed', 'in_progress'])
        .order('scheduled_date', { ascending: true });
      if (error) throw error;
      const upcoming = (data || []).map((a) => {
        const st = Array.isArray(a.service_type) ? a.service_type[0] : a.service_type;
        const pr = Array.isArray(a.property) ? a.property[0] : a.property;
        return {
          id: a.id,
          scheduled_date: a.scheduled_date,
          scheduled_time: a.scheduled_time,
          status: a.status,
          total_price: Number(a.total_price ?? 0),
          service: st?.name || 'Cleaning',
          property: pr?.name || pr?.address || null,
        };
      }) as CleanerUpcomingJob[];
      return { upcoming };
    },
  });

  return {
    upcoming: query.data?.upcoming ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export interface UpdateCleanerPayload {
  cleanerId: string;
  profile?: { first_name?: string; last_name?: string; email?: string; phone?: string };
  cleaner?: {
    payout_percent?: number;
    payout_model?: 'percentage' | 'flat' | 'request';
    flat_rate_cents?: number | null;
    hourly_rate?: number;
    experience_years?: number;
    bio?: string;
  };
  deactivated?: boolean;
}

export async function updateCleaner(
  payload: UpdateCleanerPayload,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const response = await fetch('/api/admin/update-cleaner', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: session?.access_token ? `Bearer ${session.access_token}` : '',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Failed to update cleaner' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update cleaner' };
  }
}

export async function deleteCleanerById(
  cleanerId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const response = await fetch(`/api/admin/delete-cleaner?id=${encodeURIComponent(cleanerId)}`, {
      method: 'DELETE',
      headers: { Authorization: session?.access_token ? `Bearer ${session.access_token}` : '' },
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Failed to remove cleaner' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to remove cleaner' };
  }
}

export async function cancelInvite(
  inviteId: string,
  organizationId: string,
  accessToken: string | null | undefined,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch('/api/admin/cancel-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken ? `Bearer ${accessToken}` : '',
      },
      body: JSON.stringify({ inviteId, organizationId }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.error || 'Failed to cancel invite' };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to cancel invite' };
  }
}

// ---------------------------------------------------------------------------
// Operator "Staff" segment (managers + admins + owner). Distinct from the
// legacy useState-based useAdminTeamMembers (which omits the owner and mixes in
// cleaners); this is a focused, TanStack-cached read of the non-cleaner staff
// plus their manager_permissions, for the Cleaners & team screen's Staff tab.
// ---------------------------------------------------------------------------

export interface AdminStaffMember {
  id: string; // organization_members.user_id (= user_profiles.id)
  first_name: string | null;
  last_name: string | null;
  email: string;
  avatar_url: string | null;
  role: 'owner' | 'admin' | 'manager';
  created_at: string;
  /** Manager permission flags; null for owner/admin (they have full access). */
  permissions: ManagerPermissions | null;
}

export function useAdminStaff() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';
  const queryKey = keys.staff.byOrg(orgId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId }) => {
      const { data: members, error: mErr } = await supabase
        .from('organization_members')
        .select('user_id, role, created_at')
        .eq('organization_id', orgId)
        .in('role', ['owner', 'admin', 'manager']);
      if (mErr) throw mErr;
      const rows = members ?? [];
      if (rows.length === 0) return [] as AdminStaffMember[];

      const userIds = rows.map((m) => m.user_id);
      const managerIds = rows.filter((m) => m.role === 'manager').map((m) => m.user_id);

      const { data: profiles, error: pErr } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, avatar_url')
        .in('id', userIds);
      if (pErr) throw pErr;

      let perms: Array<Record<string, unknown>> = [];
      if (managerIds.length > 0) {
        const { data: permData, error: permErr } = await supabase
          .from('manager_permissions')
          .select(
            `manager_id, ${MANAGER_FLAG_SELECT}`,
          )
          .eq('organization_id', orgId)
          .in('manager_id', managerIds);
        if (permErr) throw permErr;
        perms = (permData as unknown as Array<Record<string, unknown>>) ?? [];
      }

      const rank: Record<string, number> = { owner: 0, admin: 1, manager: 2 };
      return rows
        .map((m) => {
          const profile = profiles?.find((p) => p.id === m.user_id);
          const role = m.role as 'owner' | 'admin' | 'manager';
          const raw = role === 'manager' ? perms.find((x) => x.manager_id === m.user_id) : null;
          const permissions: ManagerPermissions | null = raw ? coerceManagerPermissions(raw) : null;
          return {
            id: m.user_id,
            first_name: profile?.first_name ?? null,
            last_name: profile?.last_name ?? null,
            email: profile?.email ?? '',
            avatar_url: profile?.avatar_url ?? null,
            role,
            created_at: m.created_at as string,
            permissions,
          } as AdminStaffMember;
        })
        .sort((a, b) => {
          const r = (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
          if (r !== 0) return r;
          const an = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || a.email;
          const bn = `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim() || b.email;
          return an.localeCompare(bn, undefined, { sensitivity: 'base' });
        });
    },
  });

  useSupabaseRealtimeSync({
    channelName: `org_staff:${orgId}`,
    table: 'organization_members',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });
  useSupabaseRealtimeSync({
    channelName: `org_staff_perms:${orgId}`,
    table: 'manager_permissions',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  return {
    staff: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
