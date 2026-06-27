'use client';

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useToast } from '../contexts/ToastContext';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { stripeNewChargeFlowUiEnabled } from '../lib/stripe/flags';
import { getAccessToken } from '../lib/auth/clientAccessToken';
import { chargeCompletedAppointmentClient } from '../lib/payments/authorizeClient';
import type { ChargeProjection, ChecklistItemCompletion } from '../types';

export interface CleanerAppointment {
  id: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  job_progress?: 'not_started' | 'before_photos' | 'checklist' | 'after_photos' | 'completed';
  total_price: number;
  special_requests?: string;
  cleaner_confirmation_status: 'awaiting' | 'approved' | 'rejected';
  /** Wave 2 SLA: cleaner-response deadline (ISO). Null once the cleaner responds. */
  response_deadline?: string | null;
  /** True when this is a homeowner-initiated request (vs admin direct-book). */
  homeowner_initiated?: boolean;
  /** Slots offered by the homeowner (1-3 rows). Empty for admin direct-book. */
  requested_slots?: Array<{ slot_index: number; scheduled_date: string; scheduled_time: string }>;
  homeowner: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  } | null;
  property: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip_code: string;
  } | null;
  service_type: {
    name: string;
    description: string;
    duration_minutes: number;
  } | null;
  checklist?: {
    name: string;
    price_adder: number;
  } | null;
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
}

export interface CleanerStats {
  totalJobs: number;
  completedThisWeek: number;
  totalEarnings: number;
  pendingPayouts: number;
  completedJobs: number;
  upcomingJobs: number;
}

export interface CleanerMessage {
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
  appointment_id?: string;
}

export interface CleanerPayout {
  id: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed';
  paid_at?: string;
  created_at: string;
  appointment: {
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

export interface CleanerPhoto {
  id: string;
  photo_url: string;
  photo_type: 'before' | 'after' | 'during';
  uploaded_at: string;
  appointment: {
    scheduled_date: string;
    homeowner: {
      first_name: string;
      last_name: string;
    } | null;
  } | null;
}

export function useCleanerAppointments() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.appointments.byCleaner(userId);

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId, userId }) => {
      const { data: cleanerProfile, error: profileError } = await supabase
        .from('cleaner_profiles')
        .select('id')
        .eq('id', userId)
        .eq('organization_id', orgId)
        .single();
      if (profileError) throw profileError;
      if (!cleanerProfile) throw new Error('Cleaner profile not found');

      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id,
          service_type_id,
          checklist_id,
          scheduled_date,
          scheduled_time,
          status,
          job_progress,
          total_price,
          special_requests,
          cleaner_confirmation_status,
          response_deadline,
          homeowner_initiated,
          is_self_pay,
          homeowner:user_profiles!homeowner_id(
            first_name,
            last_name,
            email,
            phone
          ),
          property:properties(
            name,
            address,
            city,
            state,
            zip_code
          ),
          service_type:service_types(
            name,
            description,
            duration_minutes
          ),
          checklist:checklists(
            name,
            price_adder
          ),
          appointment_requested_slots(
            slot_index,
            scheduled_date,
            scheduled_time
          )
        `)
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId)
        .order('scheduled_date', { ascending: true });

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

      return (data || []).map(appointment => {
        const a = appointment as typeof appointment & {
          homeowner_initiated?: boolean;
          appointment_requested_slots?: Array<{ slot_index: number; scheduled_date: string; scheduled_time: string }>;
        };
        return {
          ...appointment,
          homeowner: Array.isArray(appointment.homeowner) ? appointment.homeowner[0] : appointment.homeowner,
          property: Array.isArray(appointment.property) ? appointment.property[0] : appointment.property,
          service_type: Array.isArray(appointment.service_type) ? appointment.service_type[0] : appointment.service_type,
          checklist: Array.isArray(appointment.checklist) ? appointment.checklist[0] : appointment.checklist,
          payment_status: paymentStatusMap[appointment.id] || null,
          homeowner_initiated: !!a.homeowner_initiated,
          requested_slots: (a.appointment_requested_slots ?? []).slice().sort(
            (x, y) => x.slot_index - y.slot_index,
          ),
        };
      }) as CleanerAppointment[];
    },
  });

  // Cleaner-scoped channel: filter to events for THIS cleaner only. Also
  // invalidates the cleaner stats RPC so the dashboard tiles update live.
  useSupabaseRealtimeSync({
    channelName: `appointments:cleaner:${userId}`,
    table: 'appointments',
    filter: userId ? `cleaner_id=eq.${userId}` : undefined,
    enabled: !!userId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [queryKey, keys.stats.cleaner(userId), keys.payouts.byCleaner(userId)],
    }),
  });

  // Slot rows are inserted by AddAppointmentModal AFTER the appointment row
  // lands, so the appointment-table realtime can fire before the slots exist.
  // Subscribing here ensures the cleaner refetches and sees all offered chips
  // for admin-direct multi-slot appointments.
  useSupabaseRealtimeSync({
    channelName: `appointment_requested_slots:cleaner:${userId}`,
    table: 'appointment_requested_slots',
    enabled: !!userId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  // Helper for legacy callers; not currently used outside.
  const _setQuery = useCallback(
    (updater: (prev: CleanerAppointment[]) => CleanerAppointment[]) => {
      queryClient.setQueryData<CleanerAppointment[]>(queryKey, prev => updater(prev ?? []));
    },
    [queryClient, queryKey]
  );
  void _setQuery;

  return {
    appointments: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export function useCleanerStats() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: keys.stats.cleaner(userId),
    queryFn: async ({ orgId, userId }) => {
      // Fast path: single RPC (migration 049_dashboard_rpcs.sql)
      const rpcRes = await supabase.rpc('cleaner_stats', {
        p_cleaner_id: userId,
        p_org_id: orgId,
      });
      if (!rpcRes.error && rpcRes.data) {
        const r = rpcRes.data as Record<string, number>;
        return {
          totalJobs: Number(r.totalJobs ?? 0),
          completedJobs: Number(r.completedJobs ?? 0),
          upcomingJobs: Number(r.upcomingJobs ?? 0),
          completedThisWeek: Number(r.completedThisWeek ?? 0),
          totalEarnings: Number(r.totalEarnings ?? 0),
          pendingPayouts: Number(r.pendingPayouts ?? 0),
        } as CleanerStats;
      }

      // Fallback: legacy 6-query waterfall.
      const { data: cleanerProfile, error: profileError } = await supabase
        .from('cleaner_profiles')
        .select('id, payout_percent')
        .eq('id', userId)
        .eq('organization_id', orgId)
        .single();
      if (profileError) throw profileError;
      if (!cleanerProfile) throw new Error('Cleaner profile not found');

      const { count: totalJobs } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId);
      const { count: completedJobs } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId)
        .eq('status', 'completed');
      const { count: upcomingJobs } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId)
        .in('status', ['pending', 'confirmed', 'in_progress']);
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const { count: completedThisWeek } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .gte('scheduled_date', oneWeekAgo.toISOString().split('T')[0]);
      const { data: completedAppointments } = await supabase
        .from('appointments')
        .select('id, total_price')
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId)
        .eq('status', 'completed');
      const totalEarnings = (completedAppointments ?? []).reduce(
        (sum, a) => sum + Number(a.total_price),
        0
      );
      const payoutPercent = Number(cleanerProfile.payout_percent) || 0;
      const cleanerEarnings = totalEarnings * (payoutPercent / 100);
      const { data: payouts } = await supabase
        .from('payments')
        .select('amount')
        .eq('organization_id', orgId)
        .eq('status', 'paid')
        .in('appointment_id', completedAppointments?.map(a => a.id) ?? []);
      const paidAmount = (payouts ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
      const pendingPayouts = Math.max(0, cleanerEarnings - paidAmount);

      return {
        totalJobs: totalJobs || 0,
        completedJobs: completedJobs || 0,
        upcomingJobs: upcomingJobs || 0,
        completedThisWeek: completedThisWeek || 0,
        totalEarnings: Math.round(cleanerEarnings),
        pendingPayouts: Math.round(pendingPayouts),
      } as CleanerStats;
    },
  });

  return {
    stats:
      query.data ?? {
        totalJobs: 0,
        completedThisWeek: 0,
        totalEarnings: 0,
        pendingPayouts: 0,
        completedJobs: 0,
        upcomingJobs: 0,
      },
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export function useCleanerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: ['messages', 'cleaner', userId] as const,
    queryFn: async ({ orgId, userId }) => {
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
          )
        `)
        .eq('organization_id', orgId)
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(message => ({
        ...message,
        sender: Array.isArray(message.sender) ? message.sender[0] : message.sender,
      })) as CleanerMessage[];
    },
  });

  return {
    messages: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export function useCleanerPayouts() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: keys.payouts.byCleaner(userId),
    queryFn: async ({ orgId, userId }) => {
      const { data: cleanerProfile, error: profileError } = await supabase
        .from('cleaner_profiles')
        .select('id')
        .eq('id', userId)
        .eq('organization_id', orgId)
        .single();
      if (profileError) throw profileError;
      if (!cleanerProfile) throw new Error('Cleaner profile not found');

      const { data: appointments } = await supabase
        .from('appointments')
        .select('id')
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId);

      if (!appointments || appointments.length === 0) return [];

      const appointmentIds = appointments.map(a => a.id);

      const { data, error } = await supabase
        .from('payments')
        .select(`
          id,
          amount,
          status,
          paid_at,
          created_at,
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
        .in('appointment_id', appointmentIds)
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
      })) as CleanerPayout[];
    },
  });

  return {
    payouts: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export interface AwaitingPaymentRow {
  id: string;
  /** The cleaner's expected cut once the customer's bank debit clears. */
  cleanerCut: number;
  createdAt: string;
  appointment: {
    id: string;
    scheduledDate: string | null;
    homeownerName: string;
    serviceName: string | null;
  } | null;
}

/**
 * Bank (ACH) payments for THIS cleaner's appointments still clearing the customer's bank
 * (payment_status='processing', ~4 business days) — "Hop 1", distinct from a payout already on its
 * way to the cleaner's bank ("In Stripe"). The cleaner is paid only once these settle. RLS
 * (migration 075 payments_select) scopes payments to the cleaner's own appointments.
 */
export function useCleanerAwaitingPayments() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: ['cleaner-earnings', 'awaiting', userId],
    queryFn: async ({ userId }) => {
      const { data: profile } = await supabase
        .from('cleaner_profiles')
        .select('payout_percent')
        .eq('id', userId)
        .maybeSingle();
      const payoutPercent = Number((profile as { payout_percent: number | string } | null)?.payout_percent ?? 0);

      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, amount, processing_fee_cents, is_self_pay, created_at,
          appointment:appointments!inner(
            id, scheduled_date, cleaner_id,
            homeowner:user_profiles!homeowner_id(first_name, last_name),
            service_type:service_types(name)
          )
        `)
        .eq('status', 'processing')
        .eq('payment_type', 'revenue')
        .eq('appointment.cleaner_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return (data || []).map((p: Record<string, unknown>) => {
        const apptRaw = p.appointment as Record<string, unknown> | Record<string, unknown>[] | null;
        const appt = (Array.isArray(apptRaw) ? apptRaw[0] : apptRaw) as Record<string, unknown> | null;
        const hoRaw = appt?.homeowner as { first_name?: string; last_name?: string } | { first_name?: string; last_name?: string }[] | null;
        const ho = Array.isArray(hoRaw) ? hoRaw[0] : hoRaw;
        const svcRaw = appt?.service_type as { name?: string } | { name?: string }[] | null;
        const svc = Array.isArray(svcRaw) ? svcRaw[0] : svcRaw;
        const isSelfPay = Boolean(p.is_self_pay);
        const chargeCents = Math.round(Number(p.amount) * 100);
        const feeCents = Number(p.processing_fee_cents ?? 0);
        const baseCents = Math.max(0, chargeCents - feeCents);
        // Self-pay: the charge IS the cleaner's cut grossed up for the fee, so charge − fee is the
        // EXACT cut (don't re-apply payout%). Homeowner: base is the service price, cut is payout%.
        const cleanerCutCents = isSelfPay ? baseCents : Math.floor((baseCents * payoutPercent) / 100);
        return {
          id: p.id as string,
          cleanerCut: cleanerCutCents / 100,
          createdAt: p.created_at as string,
          appointment: appt
            ? {
                id: appt.id as string,
                scheduledDate: (appt.scheduled_date as string) ?? null,
                homeownerName: isSelfPay
                  ? 'Company-paid'
                  : ho
                    ? `${ho.first_name ?? ''} ${ho.last_name ?? ''}`.trim() || 'Customer'
                    : 'Customer',
                serviceName: svc?.name ?? null,
              }
            : null,
        } as AwaitingPaymentRow;
      });
    },
  });

  // Payout status flips (approved -> paid -> bank_paid, or a reversal) are driven by approvals +
  // Stripe webhooks on the payouts table. A new or changed payout row means a customer payment just
  // settled, so refresh this awaiting list plus the cleaner's stats tiles. (Relocated here from the
  // removed earnings-history hook; the embedded Stripe payouts table owns its own data, so this is
  // the one subscription that keeps our own payout-derived sections fresh.)
  useSupabaseRealtimeSync({
    channelName: `payouts:cleaner:${userId}`,
    table: 'payouts',
    filter: userId ? `cleaner_id=eq.${userId}` : undefined,
    enabled: !!userId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [
        ['cleaner-earnings', 'awaiting', userId],
        keys.stats.cleaner(userId),
        keys.payouts.byCleaner(userId),
      ],
    }),
  });

  return {
    awaitingPayments: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export function useCleanerPhotos() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: ['job-photos', 'cleaner', userId] as const,
    queryFn: async ({ orgId, userId }) => {
      const { data: cleanerProfile, error: profileError } = await supabase
        .from('cleaner_profiles')
        .select('id')
        .eq('id', userId)
        .eq('organization_id', orgId)
        .single();
      if (profileError) throw profileError;
      if (!cleanerProfile) throw new Error('Cleaner profile not found');

      const { data: appointments } = await supabase
        .from('appointments')
        .select('id')
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId);

      if (!appointments || appointments.length === 0) return [];

      const appointmentIds = appointments.map(a => a.id);

      const { data, error } = await supabase
        .from('job_photos')
        .select(`
          id,
          photo_url,
          photo_type,
          uploaded_at,
          appointment:appointments(
            scheduled_date,
            homeowner:user_profiles!homeowner_id(
              first_name,
              last_name
            )
          )
        `)
        .in('appointment_id', appointmentIds)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(photo => ({
        ...photo,
        appointment: Array.isArray(photo.appointment)
          ? {
              ...photo.appointment[0],
              homeowner: Array.isArray(photo.appointment[0]?.homeowner)
                ? photo.appointment[0].homeowner[0]
                : photo.appointment[0]?.homeowner,
            }
          : photo.appointment,
      })) as CleanerPhoto[];
    },
  });

  // job_photos carries only appointment_id (no org/cleaner column), so we can't
  // DB-filter. Subscribe unfiltered + invalidate: Supabase realtime applies RLS,
  // so the cleaner only receives events for their own appointments' photos.
  // Lets uploads from the field appear without a manual refresh.
  useSupabaseRealtimeSync({
    channelName: `job_photos:cleaner:${userId}`,
    table: 'job_photos',
    enabled: !!userId,
    onEvent: () => ({ type: 'invalidate', keys: [['job-photos', 'cleaner', userId]] }),
  });

  return {
    photos: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// Helper function to update appointment status
/**
 * Fire a job-lifecycle notification (job_started / job_completed) to the
 * homeowner + admins via the service-role route. Best-effort and fire-and-forget:
 * notification_events has no client INSERT policy, so the client cannot write it
 * directly, and a failure here must never affect the job status update.
 */
async function emitJobLifecycleNotification(
  appointmentId: string,
  event: 'started' | 'completed',
): Promise<void> {
  try {
    const { data: appt } = await supabase
      .from('appointments')
      .select('organization_id')
      .eq('id', appointmentId)
      .single();
    const organizationId = (appt as { organization_id?: string } | null)?.organization_id;
    if (!organizationId) return;
    const token = await getAccessToken();
    await fetch(`/api/appointments/${appointmentId}/lifecycle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organizationId, event }),
    });
  } catch (err) {
    console.error('Failed to emit job lifecycle notification (non-blocking):', err);
  }
}

export async function updateAppointmentStatus(appointmentId: string, status: string) {
  try {
    // Prepare update object
    const updateData: { status: string; job_progress?: string } = { status };

    // If transitioning to in_progress, set job_progress to before_photos
    if (status === 'in_progress') {
      updateData.job_progress = 'before_photos';
    } else if (status === 'completed') {
      updateData.job_progress = 'completed';
    }

    const { error } = await supabase
      .from('appointments')
      .update(updateData)
      .eq('id', appointmentId);

    if (error) throw error;

    // Notify homeowner + admins that the job started/finished (best-effort).
    if (status === 'in_progress' || status === 'completed') {
      void emitJobLifecycleNotification(
        appointmentId,
        status === 'in_progress' ? 'started' : 'completed',
      );
    }

    // If status changed to 'completed', trigger automatic payment
    if (status === 'completed') {
      try {
        // Get appointment details for organization_id
        const { data: appointment } = await supabase
          .from('appointments')
          .select('organization_id')
          .eq('id', appointmentId)
          .single();

        // New charge flow: a card is saved (not held) at booking, so charge the saved card now that
        // the job is complete (the assigned cleaner is permitted). Non-fatal: a payment problem (no
        // card, declined, tenant not ready) still completes the job and surfaces in "Payments needing
        // attention" for follow-up.
        if (stripeNewChargeFlowUiEnabled()) {
          const result = await chargeCompletedAppointmentClient(appointmentId, appointment?.organization_id);
          return { success: true, ...result };
        }

        const response = await fetch('/api/stripe/create-payment-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            appointment_id: appointmentId,
            organization_id: appointment?.organization_id,
          }),
        });

        let result;
        try {
          result = await response.json();
        } catch (parseError) {
          console.error('Payment response parse error:', parseError);
          // Don't fail the status update, just log the payment error
          return { 
            success: true, 
            paymentStatus: 'failed',
            paymentError: 'Failed to parse payment response'
          };
        }

        if (!response.ok) {
          console.error('Payment failed:', result.error);
          // Don't fail the status update, just log the payment error
          // The payment can be retried manually
          return { 
            success: true, 
            paymentStatus: 'failed',
            paymentError: result.error || 'Payment processing failed'
          };
        }

        return { 
          success: true, 
          paymentStatus: result.payment_intent_status === 'succeeded' ? 'paid' : 'pending',
          paymentIntentId: result.payment_intent_id
        };
      } catch (paymentError) {
        console.error('Error processing payment:', paymentError);
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

// Helper function to update job progress
export async function updateJobProgress(
  appointmentId: string,
  progress: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('appointments')
      .update({ job_progress: progress })
      .eq('id', appointmentId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update job progress',
    };
  }
}

export type UseChecklistArgs = {
  /** Appointment-selected checklist (preferred). */
  checklistId: string | null;
  /** Used when checklist_id is missing (legacy rows) or primary fetch fails. */
  serviceTypeId: string | null;
};

async function fetchLineItemsForChecklist(checklistRowId: string) {
  const { data: lineItemsData, error: lineItemsError } = await supabase
    .from('checklist_line_items')
    .select('id, task, position')
    .eq('checklist_id', checklistRowId)
    .order('position', { ascending: true, nullsFirst: false });

  if (lineItemsError) throw lineItemsError;
  return lineItemsData || [];
}

/**
 * Loads the checklist tied to an appointment: prefers `checklistId`, then falls back
 * to the first checklist for `service_type_id` (name ASC, created_at ASC) for legacy data.
 */
const EMPTY_LINE_ITEMS: { id: string; task: string; position: number | null }[] = [];

export function useChecklist({ checklistId, serviceTypeId }: UseChecklistArgs) {
  const query = useOrgQuery({
    queryKey: ['checklist', 'detail', checklistId ?? '', serviceTypeId ?? ''] as const,
    enabled: !!(checklistId || serviceTypeId),
    queryFn: async () => {
      let checklistData: {
        id: string;
        name: string;
        service_type_id: string;
      } | null = null;

      if (checklistId) {
        const { data, error: byIdError } = await supabase
          .from('checklists')
          .select('id, name, service_type_id')
          .eq('id', checklistId)
          .maybeSingle();
        if (byIdError) throw byIdError;
        checklistData = data;
      }

      if (!checklistData && serviceTypeId) {
        const { data, error: byServiceError } = await supabase
          .from('checklists')
          .select('id, name, service_type_id')
          .eq('service_type_id', serviceTypeId)
          .order('name', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (byServiceError) throw byServiceError;
        checklistData = data;
      }

      if (!checklistData) {
        return { checklist: null, lineItems: [] as { id: string; task: string; position: number | null }[] };
      }

      const lineItems = await fetchLineItemsForChecklist(checklistData.id);
      return { checklist: checklistData, lineItems };
    },
  });

  return {
    checklist: query.data?.checklist ?? null,
    // Stable empty-array fallback so consumers that depend on lineItems don't
    // re-fire effects on every render before data arrives.
    lineItems: query.data?.lineItems ?? EMPTY_LINE_ITEMS,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job photo types
// ─────────────────────────────────────────────────────────────────────────────

export interface JobPhoto {
  id: string;
  photo_url: string;
  photo_type: 'before' | 'after' | 'during';
  uploaded_at: string;
}

export interface UseJobPhotosResult {
  beforePhotos: JobPhoto[];
  afterPhotos: JobPhoto[];
  allPhotos: JobPhoto[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches before/after/during photos for a specific appointment.
 * Splits results into beforePhotos and afterPhotos for direct use in ActiveJobPage.
 * Call refetch() after an upload to refresh the list.
 */
export function useJobPhotosForAppointment(appointmentId: string | null): UseJobPhotosResult {
  const queryClient = useQueryClient();
  const queryKey = keys.jobPhotos.byAppointment(appointmentId ?? '');

  const query = useOrgQuery({
    queryKey,
    enabled: !!appointmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_photos')
        .select('id, photo_url, photo_type, uploaded_at')
        .eq('appointment_id', appointmentId as string)
        .order('uploaded_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as JobPhoto[];
    },
  });

  const allPhotos = query.data ?? [];
  const beforePhotos = allPhotos.filter(p => p.photo_type === 'before');
  const afterPhotos = allPhotos.filter(p => p.photo_type === 'after');

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    beforePhotos,
    afterPhotos,
    allPhotos,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch,
  };
}

export type DeclineReason = 'sick' | 'not_my_service' | 'too_far' | 'other';

/** Start a confirmed job (status -> in_progress; fires the 'started' lifecycle
 * notification inside updateAppointmentStatus). */
export function useStartJob() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id;
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const r = (await updateAppointmentStatus(appointmentId, 'in_progress')) as { success: boolean; error?: string };
      if (!r.success) throw new Error(r.error || 'Could not start the job');
      return r;
    },
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
        qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
      }
      showToast('Job started', { variant: 'success' });
    },
    onError: (e: Error) => showToast(e.message, { variant: 'error' }),
  });
}

/** Accept or decline a job offer via POST /api/appointments/confirm. */
export function useRespondToOffer() {
  const { user, currentOrganizationId } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id;

  async function post(body: Record<string, unknown>) {
    const token = await getAccessToken();
    const res = await fetch('/api/appointments/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organizationId: currentOrganizationId, ...body }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !(data as { success?: boolean }).success) {
      const msg = (data as { error?: string; message?: string }).error
        || (data as { message?: string }).message
        || 'Could not submit your response';
      throw new Error(msg);
    }
    return data;
  }

  function invalidate() {
    if (!userId) return;
    qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
    qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
  }

  const accept = useMutation({
    mutationFn: (v: { appointmentId: string; slotIndex: number }) =>
      post({ appointmentId: v.appointmentId, action: 'accept', slotIndex: v.slotIndex }),
    onSuccess: () => { invalidate(); showToast('Job accepted', { variant: 'success' }); },
    onError: (e: Error) => showToast(e.message, { variant: 'error' }),
  });

  const decline = useMutation({
    mutationFn: (v: { appointmentId: string; reason: DeclineReason; other?: string }) =>
      post({ appointmentId: v.appointmentId, action: 'decline', declineReason: v.reason, declineReasonOther: v.other }),
    onSuccess: () => { invalidate(); showToast('Offer declined', { variant: 'info' }); },
    onError: (e: Error) => showToast(e.message, { variant: 'error' }),
  });

  return { accept, decline };
}

// ─────────────────────────────────────────────────────────────────────────────
// Active-job flow hooks (Slice 3)
// ─────────────────────────────────────────────────────────────────────────────

/** Complete a job (status -> completed; triggers charge + lifecycle notification).
 * Returns { chargeOutcome } mapped from the completion charge paymentStatus. */
export function useCompleteJob() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const userId = user?.id;
  return useMutation({
    mutationFn: async (appointmentId: string): Promise<{ chargeOutcome?: string }> => {
      const r = await updateAppointmentStatus(appointmentId, 'completed') as {
        success: boolean;
        error?: string;
        paymentStatus?: string;
      };
      if (!r.success) throw new Error(r.error || 'Could not complete the job');
      return { chargeOutcome: r.paymentStatus };
    },
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
        qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
      }
      showToast('Job completed', { variant: 'success' });
    },
    onError: (e: Error) => showToast(e.message, { variant: 'error' }),
  });
}

/** Silently update job_progress (step transitions; no toast). */
export function useUpdateJobProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      appointmentId,
      progress,
    }: {
      appointmentId: string;
      progress: string;
    }): Promise<void> => {
      const r = await updateJobProgress(appointmentId, progress);
      if (!r.success) throw new Error(r.error || 'Could not update job progress');
    },
    onSuccess: (_data, { appointmentId }) => {
      qc.invalidateQueries({ queryKey: keys.appointments.detail(appointmentId) });
    },
  });
}

/** Read checklist item completions for an appointment as a Set of checklist_line_item_ids.
 * Uses the anon Supabase client so the cleaner RLS policy authorizes reads. */
export function useChecklistCompletions(appointmentId: string | null) {
  const queryKey = keys.appointments.checklistCompletions(appointmentId ?? '');
  const query = useOrgQuery({
    queryKey,
    enabled: !!appointmentId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('checklist_item_completions')
        .select('checklist_line_item_id')
        .eq('appointment_id', appointmentId as string);
      if (error) throw error;
      return new Set(
        (data ?? []).map(
          (r: Pick<ChecklistItemCompletion, 'checklist_line_item_id'>) => r.checklist_line_item_id,
        ),
      );
    },
  });
  return {
    completed: query.data ?? new Set<string>(),
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

/** Toggle a checklist line item completion for an appointment.
 * Optimistic: updates the cached Set immediately, then invalidates on settle.
 * organization_id is sourced from auth context so RLS reads by org staff are authorized. */
export function useToggleChecklistItem() {
  const { currentOrganizationId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      appointmentId,
      lineItemId,
      done,
    }: {
      appointmentId: string;
      lineItemId: string;
      done: boolean;
    }): Promise<void> => {
      if (done) {
        const { error } = await supabase
          .from('checklist_item_completions')
          .upsert(
            {
              appointment_id: appointmentId,
              checklist_line_item_id: lineItemId,
              organization_id: currentOrganizationId ?? null,
            },
            { onConflict: 'appointment_id,checklist_line_item_id' },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('checklist_item_completions')
          .delete()
          .eq('appointment_id', appointmentId)
          .eq('checklist_line_item_id', lineItemId);
        if (error) throw error;
      }
    },
    onMutate: async ({ appointmentId, lineItemId, done }) => {
      const queryKey = keys.appointments.checklistCompletions(appointmentId);
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Set<string>>(queryKey);
      qc.setQueryData<Set<string>>(queryKey, (old) => {
        const next = new Set(old ?? []);
        if (done) next.add(lineItemId);
        else next.delete(lineItemId);
        return next;
      });
      return { previous, queryKey };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) {
        qc.setQueryData(ctx.queryKey, ctx.previous);
      }
    },
    onSettled: (_data, _err, { appointmentId }) => {
      qc.invalidateQueries({ queryKey: keys.appointments.checklistCompletions(appointmentId) });
    },
  });
}

/** Fetch the charge projection for the active-job completion summary.
 * Lazy: only fetches when `enabled` (e.g. the completion sheet is open). */
export function useChargeProjection(appointmentId: string | null, enabled: boolean) {
  const queryKey = keys.appointments.chargeProjection(appointmentId ?? '');
  const query = useOrgQuery({
    queryKey,
    enabled: enabled && !!appointmentId,
    queryFn: async (): Promise<ChargeProjection | null> => {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/charge-projection`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error('Could not load charge projection');
      const body = (await res.json()) as { projection: ChargeProjection | null };
      return body.projection;
    },
  });
  return {
    projection: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

/** POST photo-skip for an appointment; invalidates appointment detail + byCleaner lists. */
export function useSkipPhotos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  return useMutation({
    mutationFn: async ({
      appointmentId,
      reason,
    }: {
      appointmentId: string;
      reason: string;
    }): Promise<void> => {
      const token = await getAccessToken();
      const res = await fetch(`/api/appointments/${appointmentId}/photo-skip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as Record<string, unknown>));
        throw new Error((data as { error?: string }).error || 'Could not skip photos');
      }
    },
    onSuccess: (_data, { appointmentId }) => {
      qc.invalidateQueries({ queryKey: keys.appointments.detail(appointmentId) });
      if (userId) {
        qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
      }
    },
  });
}
