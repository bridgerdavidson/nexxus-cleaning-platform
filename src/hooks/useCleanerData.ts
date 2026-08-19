'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { toast } from '../components/ui/toast';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { readCleanerApptCache, writeCleanerApptCache } from './cleanerApptCache';
import { keys } from '../lib/queryKeys';
import { checklistToggleMutationOptions } from '../lib/checklist/toggleChecklist';
import { getAccessToken } from '../lib/auth/clientAccessToken';
import { chargeCompletedAppointmentClient } from '../lib/payments/authorizeClient';
import type { PayRequestOutcome } from '../components/redesign/cleaner/job/active-job-presenters';
import type { ChargeProjection, ChecklistItemCompletion } from '../types';

export interface CleanerAppointment {
  id: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  job_progress?: 'not_started' | 'before_photos' | 'checklist' | 'after_photos' | 'completed';
  /** True once the cleaner skipped the photo gate with a reason (migration 095). */
  photos_skipped?: boolean;
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
  } | null;
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
  /** Set when the job is marked complete (charge-at-completion). Drives the 24h job-message grace window. */
  completed_at?: string | null;
  /** Set when the appointment is cancelled. Closes the job thread. */
  cancelled_at?: string | null;
  /** Non-null when this appointment is one occurrence of a recurring series
   *  (Slice 2). All occurrences of the same series share this id. */
  series_id?: string | null;
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

export function useCleanerAppointments() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();
  const queryKey = keys.appointments.byCleaner(userId);

  // Seed from the last-known offline snapshot so a cold open on no signal shows
  // real jobs/addresses instead of skeleton then error. initialData makes the
  // query "success" with stale data, so an online mount refetches in the
  // background while an offline mount just keeps showing it (a failed background
  // refetch never flips it to an error while data is present).
  const cachedSnapshot = useMemo(() => readCleanerApptCache<CleanerAppointment>(userId), [userId]);

  const query = useOrgQuery({
    queryKey,
    ...(cachedSnapshot ? { initialData: cachedSnapshot.data, initialDataUpdatedAt: cachedSnapshot.ts } : {}),
    // NOT a Supabase query: the price-seal migration removed the cleaner's SELECT arm on
    // appointments (the row carries total_price, which a request-mode cleaner
    // must never see), so /api/cleaner/appointments shapes a price-free payload
    // server-side. That also killed the old appointments realtime channel here:
    // postgres_changes is RLS-gated per subscriber, so a cleaner subscription
    // would be silently filtered out of every change and never fire. Polling is
    // the honest signal, same as useCleanerPayRequests.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ orgId, accessToken, signal }) => {
      const res = await fetch(`/api/cleaner/appointments?organization_id=${orgId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!res.ok) throw new Error('Could not load your jobs');
      const data = (await res.json()) as { appointments: CleanerAppointment[] };
      return data.appointments;
    },
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

  // Persist each successfully-loaded list for the next offline open. Keyed off the
  // query's own dataUpdatedAt: re-persisting the seeded snapshot on mount writes
  // back the same data + ts (idempotent, never extends its life), and a failed
  // refetch (which doesn't advance dataUpdatedAt) writes nothing.
  useEffect(() => {
    if (query.isSuccess && query.data && query.dataUpdatedAt) {
      writeCleanerApptCache(userId, query.data, query.dataUpdatedAt);
    }
  }, [query.isSuccess, query.data, query.dataUpdatedAt, userId]);

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
    // The appointments realtime channel that used to invalidate this key died
    // with the price-seal migration (see useCleanerAppointments); a slow poll keeps the
    // tiles honest between job completions.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ orgId, userId }) => {
      // Single RPC round trip (cleaner_stats is SECURITY DEFINER + self-authorizing
      // since the price-seal migration, so it survives the cleaner's removed SELECT arm).
      const rpcRes = await supabase.rpc('cleaner_stats', {
        p_cleaner_id: userId,
        p_org_id: orgId,
      });
      if (rpcRes.error) throw rpcRes.error;
      const r = (rpcRes.data ?? {}) as Record<string, number>;
      return {
        totalJobs: Number(r.totalJobs ?? 0),
        completedJobs: Number(r.completedJobs ?? 0),
        upcomingJobs: Number(r.upcomingJobs ?? 0),
        completedThisWeek: Number(r.completedThisWeek ?? 0),
        totalEarnings: Number(r.totalEarnings ?? 0),
        pendingPayouts: Number(r.pendingPayouts ?? 0),
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
    refetch: query.refetch,
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

export interface AwaitingPaymentRow {
  id: string;
  /** The cleaner's expected cut once the customer's bank debit clears. */
  cleanerCut: number;
  createdAt: string;
  paymentMethod: string | null;
  appointment: {
    id: string;
    scheduledDate: string | null;
    homeownerName: string;
    serviceName: string | null;
  } | null;
}

export interface CleanerPaidPayoutRow {
  id: string;
  /** payouts.amount is the transfer TO the cleaner (their own cut), so it is privacy-safe to render. */
  amount: number;
  /** 'paid' = in their Stripe balance / heading to the bank; 'bank_paid' = deposited. */
  status: 'paid' | 'bank_paid';
  createdAt: string;
  paidAt: string | null;
  appointment: {
    id: string;
    scheduledDate: string | null;
    homeownerName: string;
    serviceName: string | null;
  } | null;
}

type CleanerEarningsResponse = {
  awaiting: AwaitingPaymentRow[];
  held: CleanerHeldPayoutRow[];
  paid: CleanerPaidPayoutRow[];
};

/**
 * One shared query behind BOTH earnings sections. NOT a Supabase read: migration
 * The price-seal migration removed the cleaner's arm from payments_select (payments.amount is the
 * full customer charge, the number a request-mode cleaner must never see), so
 * GET /api/cleaner/earnings computes the cleaner's cut server-side, per their
 * pay mode, mirroring the settlement math. Both wrapper hooks use the same
 * queryKey, so a screen mounting both still fetches once.
 */
function useCleanerEarningsQuery() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const query = useOrgQuery({
    queryKey: ['cleaner-earnings', 'route', userId] as const,
    // Payments-table realtime can't reach the cleaner anymore (price-seal). The payouts
    // subscriptions below still fire on settlement; this poll is the backstop
    // for Hop-1 status flips that never touch payouts.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ orgId, accessToken, signal }): Promise<CleanerEarningsResponse> => {
      const res = await fetch(`/api/cleaner/earnings?organization_id=${orgId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!res.ok) throw new Error('Could not load your earnings');
      return (await res.json()) as CleanerEarningsResponse;
    },
  });
  return { userId, query };
}

/**
 * Bank (ACH) payments for THIS cleaner's appointments still clearing the customer's bank
 * (payment_status='processing', ~4 business days) — "Hop 1", distinct from a payout already on its
 * way to the cleaner's bank ("In Stripe"). The cleaner is paid only once these settle.
 */
export function useCleanerAwaitingPayments() {
  const { userId, query } = useCleanerEarningsQuery();

  // Payout status flips (approved -> paid -> bank_paid, or a reversal) are driven by approvals +
  // Stripe webhooks on the payouts table. A new or changed payout row means a customer payment just
  // settled, so refresh the earnings payload plus the cleaner's stats tiles. (payouts_select keeps
  // its direct cleaner_id arm, so this subscription still fires after the price-seal migration.)
  useSupabaseRealtimeSync({
    channelName: `payouts:cleaner:${userId}`,
    table: 'payouts',
    filter: userId ? `cleaner_id=eq.${userId}` : undefined,
    enabled: !!userId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [
        ['cleaner-earnings', 'route', userId],
        keys.stats.cleaner(userId),
      ],
    }),
  });

  return {
    awaitingPayments: query.data?.awaiting ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

export interface CleanerHeldPayoutRow {
  id: string;
  /** payouts.amount is the transfer TO the cleaner (their own cut), so it is privacy-safe to render. */
  amount: number;
  status: 'pending' | 'approved' | 'failed';
  createdAt: string;
  appointment: {
    id: string;
    scheduledDate: string | null;
    homeownerName: string;
    serviceName: string | null;
  } | null;
}

/**
 * The cleaner's own payout rows that are owed but not yet in their bank: 'pending'/'approved' (held,
 * e.g. awaiting onboarding or admin approval) and 'failed' (the platform->cleaner transfer errored).
 * This is "Hop 2", after a customer payment has settled, and is distinct from
 * useCleanerAwaitingPayments ("Hop 1", the customer's bank debit still clearing). Without this the
 * redesign Earnings screen showed only in-flight ACH + the Stripe embed, so a held or failed slice
 * (the Wanda-Jones onboarding stall) was invisible and the setup card read "No earnings yet".
 * payouts.amount is the cleaner's cut (never the customer charge); the appointment labels come from
 * the earnings route since the price-seal migration removed the cleaner's appointments SELECT arm.
 */
export function useCleanerHeldPayouts() {
  const { userId, query } = useCleanerEarningsQuery();

  // A payout row status flip (transfer sent, failed, approved) means the held/failed slice changed.
  // Own subscription: useSupabaseRealtimeSync gives each hook a unique topic (useId), so this and
  // useCleanerAwaitingPayments can both watch `payouts` for this cleaner without colliding.
  useSupabaseRealtimeSync({
    channelName: `payouts:cleaner:held:${userId}`,
    table: 'payouts',
    filter: userId ? `cleaner_id=eq.${userId}` : undefined,
    enabled: !!userId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [['cleaner-earnings', 'route', userId]],
    }),
  });

  return {
    heldPayouts: query.data?.held ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}

/**
 * The cleaner's recent settled payouts ('paid'/'bank_paid'), i.e. money that already went out.
 * Without this the Earnings screen only ever showed in-flight money, and the happy path (card
 * clears in seconds, onboarded cleaner's payout written straight to 'paid') rendered as
 * "No earnings yet" forever. Reads the same shared earnings query; realtime refresh comes from
 * the payouts subscriptions in the sibling hooks mounted on the same screen, which invalidate
 * the shared queryKey on any payout status flip.
 */
export function useCleanerPaidPayouts() {
  const { query } = useCleanerEarningsQuery();
  return {
    paidPayouts: query.data?.paid ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
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
  organizationId: string | undefined,
): Promise<void> {
  try {
    // The org id comes from the caller's auth context: since the price-seal migration a
    // cleaner cannot SELECT the appointment row to look it up.
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

export async function updateAppointmentStatus(
  appointmentId: string,
  status: string,
  organizationId?: string,
) {
  try {
    // Prepare update object
    const updateData: { status: string; job_progress?: string } = { status };

    // If transitioning to in_progress, set job_progress to before_photos
    if (status === 'in_progress') {
      updateData.job_progress = 'before_photos';
    } else if (status === 'completed') {
      updateData.job_progress = 'completed';
    }

    // NOT a direct Supabase write: a Postgres UPDATE's WHERE clause needs
    // SELECT rights on the row, so once the price-seal migration sealed the cleaner's
    // appointments SELECT a direct update silently matches zero rows. The
    // status route performs the write with the service role after verifying
    // the assignment.
    if (!organizationId) throw new Error('No organization');
    const token = await getAccessToken();
    const res = await fetch(`/api/cleaner/appointments/${appointmentId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organization_id: organizationId, ...updateData }),
    });
    const routeBody = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(routeBody.error || 'Could not update the job');

    // Notify homeowner + admins that the job started/finished (best-effort).
    if (status === 'in_progress' || status === 'completed') {
      void emitJobLifecycleNotification(
        appointmentId,
        status === 'in_progress' ? 'started' : 'completed',
        organizationId,
      );
    }

    // If status changed to 'completed', trigger automatic payment
    if (status === 'completed') {
      try {
        // New charge flow: a card is saved (not held) at booking, so charge the saved card now that
        // the job is complete (the assigned cleaner is permitted). Non-fatal: a payment problem (no
        // card, declined, tenant not ready) still completes the job and surfaces in "Payments needing
        // attention" for follow-up.
        const result = await chargeCompletedAppointmentClient(appointmentId, organizationId);
        return { success: true, ...result };
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
  progress: string,
  organizationId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Same status route as updateAppointmentStatus: direct cleaner writes to
    // appointments are dead since the price-seal migration (see the note there).
    if (!organizationId) throw new Error('No organization');
    const token = await getAccessToken();
    const res = await fetch(`/api/cleaner/appointments/${appointmentId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organization_id: organizationId, job_progress: progress }),
    });
    const routeBody = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(routeBody.error || 'Failed to update job progress');

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
          // First tier in the locked canonical order (cheapest, then oldest;
          // matches compareChecklists), so this fallback agrees with the UI.
          .order('price_adder', { ascending: true })
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

export type DeclineReason = 'sick' | 'not_available' | 'not_my_service' | 'too_far' | 'other';

/** Start a confirmed job (status -> in_progress; fires the 'started' lifecycle
 * notification inside updateAppointmentStatus). */
export function useStartJob() {
  const { user, currentOrganizationId } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const r = (await updateAppointmentStatus(
        appointmentId,
        'in_progress',
        currentOrganizationId ?? undefined,
      )) as { success: boolean; error?: string };
      if (!r.success) throw new Error(r.error || 'Could not start the job');
      return r;
    },
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
        qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
      }
      toast.success('Job started');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Accept or decline a job offer via POST /api/appointments/confirm. */
export function useRespondToOffer() {
  const { user, currentOrganizationId } = useAuth();
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
    onSuccess: () => { invalidate(); toast.success('Job accepted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const decline = useMutation({
    mutationFn: (v: { appointmentId: string; reason: DeclineReason; other?: string }) =>
      post({ appointmentId: v.appointmentId, action: 'decline', declineReason: v.reason, declineReasonOther: v.other }),
    onSuccess: () => { invalidate(); toast.info('Offer declined'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { accept, decline };
}

export interface SeriesRespondResult {
  total: number;
  succeeded: number;
  failed: number;
}

/**
 * Accept or decline EVERY occurrence of a recurring offer in one call, via the
 * bulk route POST /api/appointments/confirm-series. The route is keyed by
 * seriesId and acts on the cleaner's still-`awaiting` occurrences server-side, so
 * it never re-processes a date already actioned via the single confirm route.
 * Decline applies one shared reason and routes each date away independently.
 */
export function useRespondToSeries() {
  const { user, currentOrganizationId } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;

  async function postSeries(body: Record<string, unknown>): Promise<SeriesRespondResult> {
    const token = await getAccessToken();
    const res = await fetch('/api/appointments/confirm-series', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organizationId: currentOrganizationId, ...body }),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !(data as { success?: boolean }).success) {
      throw new Error((data as { error?: string }).error || 'Could not update the series');
    }
    const d = data as { total?: number; succeeded?: number; failed?: number };
    return { total: d.total ?? 0, succeeded: d.succeeded ?? 0, failed: d.failed ?? 0 };
  }

  function invalidate() {
    if (!userId) return;
    qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
    qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
  }

  const acceptAllM = useMutation({
    mutationFn: (seriesId: string) => postSeries({ seriesId, action: 'accept' }),
    onSuccess: (r) => {
      invalidate();
      if (r.total === 0) {
        toast.info('These cleanings were already handled.');
      } else if (r.failed === 0) {
        toast.success(`Accepted ${r.succeeded} ${r.succeeded === 1 ? 'cleaning' : 'cleanings'}`);
      } else if (r.succeeded === 0) {
        toast.error('Could not accept these cleanings. Please try again.');
      } else {
        toast.info(`Accepted ${r.succeeded} of ${r.total}. ${r.failed} could not be accepted.`);
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Could not accept the series'),
  });

  const declineAllM = useMutation({
    mutationFn: (v: { seriesId: string; reason: DeclineReason; other?: string }) =>
      postSeries({ seriesId: v.seriesId, action: 'decline', declineReason: v.reason, declineReasonOther: v.other }),
    onSuccess: (r) => {
      invalidate();
      if (r.total === 0) {
        toast.info('These cleanings were already handled.');
      } else if (r.failed === 0) {
        toast.info(`Declined ${r.succeeded} ${r.succeeded === 1 ? 'cleaning' : 'cleanings'}`);
      } else {
        toast.info(`Declined ${r.succeeded} of ${r.total}.`);
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Could not decline the series'),
  });

  return {
    acceptAll: (seriesId: string) => acceptAllM.mutateAsync(seriesId),
    declineAll: (seriesId: string, reason: DeclineReason, other?: string) =>
      declineAllM.mutateAsync({ seriesId, reason, other }),
    accepting: acceptAllM.isPending,
    declining: declineAllM.isPending,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Active-job flow hooks (Slice 3)
// ─────────────────────────────────────────────────────────────────────────────

/** Complete a job (status -> completed; triggers charge + lifecycle notification).
 * Returns { chargeOutcome } mapped from the completion charge paymentStatus.
 *
 * For a REQUEST-mode cleaner, pass `requestAmountCents`: the pay request is
 * POSTed BEFORE the status write, so a completed request-mode job can never
 * exist without its pay thread. If the POST fails, completion is blocked and
 * the error surfaces for a retry; a 409 duplicate (a retry whose earlier POST
 * actually landed) counts as submitted and completion proceeds. */
export function useCompleteJob() {
  const { user, currentOrganizationId } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;
  return useMutation({
    mutationFn: async (
      args: string | { appointmentId: string; requestAmountCents?: number; note?: string },
    ): Promise<{ chargeOutcome?: string; payRequest?: PayRequestOutcome }> => {
      const appointmentId = typeof args === 'string' ? args : args.appointmentId;
      const requestAmountCents = typeof args === 'string' ? undefined : args.requestAmountCents;
      const note = typeof args === 'string' ? undefined : args.note;

      let payRequest: PayRequestOutcome | undefined;
      if (requestAmountCents !== undefined) {
        if (!currentOrganizationId) throw new Error('No organization');
        const token = await getAccessToken();
        const res = await fetch(`/api/appointments/${appointmentId}/pay-request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            organization_id: currentOrganizationId,
            amount_cents: requestAmountCents,
            ...(note ? { note } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          autoApproved?: boolean;
        };
        if (res.ok) {
          payRequest = {
            submitted: true,
            autoApproved: !!data.autoApproved,
            amountCents: requestAmountCents,
          };
        } else if (res.status === 409 && data.code === 'duplicate') {
          // A thread already exists for this job (an earlier attempt landed, or
          // the org opened one). The amount just typed was NOT applied, so the
          // completion proceeds but the success copy must not quote it back as
          // though it had been sent. `amountCents: null` selects the
          // amount-free branch.
          payRequest = { submitted: true, autoApproved: false, amountCents: null };
        } else {
          // Blocked on purpose: never complete a request-mode job without a thread.
          throw new Error(data.error || 'Could not send your pay request');
        }
      }

      const r = await updateAppointmentStatus(
        appointmentId,
        'completed',
        currentOrganizationId ?? undefined,
      ) as {
        success: boolean;
        error?: string;
        paymentStatus?: string;
      };
      if (!r.success) throw new Error(r.error || 'Could not complete the job');
      // Map the paymentStatus ('paid'|'processing'|'failed') to the outcome-code
      // vocabulary the Complete sheet keys off ('charged'|'processing'|'failed').
      return {
        chargeOutcome: r.paymentStatus === 'paid' ? 'charged' : r.paymentStatus,
        payRequest,
      };
    },
    onSuccess: () => {
      if (userId) {
        qc.invalidateQueries({ queryKey: keys.appointments.byCleaner(userId) });
        qc.invalidateQueries({ queryKey: keys.stats.cleaner(userId) });
        qc.invalidateQueries({ queryKey: keys.payRequests.byCleaner(userId) });
      }
      toast.success('Job completed');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Silently update job_progress (step transitions; no toast). */
export function useUpdateJobProgress() {
  const { currentOrganizationId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      appointmentId,
      progress,
    }: {
      appointmentId: string;
      progress: string;
    }): Promise<void> => {
      const r = await updateJobProgress(appointmentId, progress, currentOrganizationId ?? undefined);
      if (!r.success) throw new Error(r.error || 'Could not update job progress');
    },
    onSuccess: (_data, { appointmentId }) => {
      qc.invalidateQueries({ queryKey: keys.appointments.detail(appointmentId) });
    },
  });
}

// Stable empty-Set fallback so consumers that depend on `completed` don't see a
// fresh reference on every render before data arrives (mirrors EMPTY_LINE_ITEMS).
const EMPTY_COMPLETIONS: ReadonlySet<string> = new Set<string>();

/** Read checklist item completions for an appointment as a Set of checklist_line_item_ids.
 * Uses the anon Supabase client so the cleaner RLS policy authorizes reads. */
export function useChecklistCompletions(appointmentId: string | null) {
  const queryKey = keys.appointments.checklistCompletions(appointmentId ?? '');
  const query = useOrgQuery({
    queryKey,
    enabled: !!appointmentId,
    queryFn: async ({ signal }): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from('checklist_item_completions')
        .select('checklist_line_item_id')
        .eq('appointment_id', appointmentId as string)
        .abortSignal(signal);
      if (error) throw error;
      return new Set(
        (data ?? []).map(
          (r: Pick<ChecklistItemCompletion, 'checklist_line_item_id'>) => r.checklist_line_item_id,
        ),
      );
    },
  });
  return {
    completed: query.data ?? EMPTY_COMPLETIONS,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

/** Toggle a checklist line item completion for an appointment.
 * Optimistic per-item cache updates; the refetch fires only after the LAST
 * in-flight toggle settles so rapid taps can't be unchecked by a stale
 * response (see src/lib/checklist/toggleChecklist.ts + its test).
 * organization_id is sourced from auth context so RLS reads by org staff are authorized. */
export function useToggleChecklistItem() {
  const { currentOrganizationId } = useAuth();
  const qc = useQueryClient();
  return useMutation(
    checklistToggleMutationOptions(qc, async ({ appointmentId, lineItemId, done }) => {
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
    }),
  );
}

/** Fetch the charge projection for the active-job completion summary.
 * Lazy: only fetches when `enabled` (e.g. the completion sheet is open). */
/**
 * The signed-in cleaner's own pay mode, read straight from their
 * cleaner_profiles row (which they can already read, same as payout_percent).
 *
 * Deliberately NOT derived from the charge projection: that route 404s whenever
 * the Stripe flags are off and throws on any transient failure, and a
 * request-mode cleaner who silently fell back to the plain completion path
 * would complete a job with no pay thread, which is the one thing this feature
 * must never allow. `status` lets the caller fail closed instead of guessing.
 */
export function useCleanerPayoutModel(): {
  payoutModel: 'percentage' | 'flat' | 'request' | 'hourly_external' | null;
  status: 'loading' | 'ready' | 'error';
} {
  const { user } = useAuth();
  const userId = user?.id;
  const query = useQuery({
    queryKey: keys.cleanerProfiles.detail(userId ?? 'anon'),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cleaner_profiles')
        .select('payout_model')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      const raw = (data as { payout_model: string | null } | null)?.payout_model ?? 'percentage';
      // The pre-118 spelling normalizes to the percentage default branch.
      return (raw === 'percentage_contractor' ? 'percentage' : raw) as
        | 'percentage'
        | 'flat'
        | 'request'
        | 'hourly_external';
    },
  });
  return {
    payoutModel: query.data ?? null,
    status: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
  };
}

export function useChargeProjection(appointmentId: string | null, enabled: boolean) {
  const { currentOrganizationId } = useAuth();
  // Org in the key so a switch refetches; the route requires organization_id via
  // requireOrgAuth (400 without it), so only fetch once we have one.
  const queryKey = [
    ...keys.appointments.chargeProjection(appointmentId ?? ''),
    currentOrganizationId ?? '',
  ] as const;
  const query = useQuery({
    queryKey,
    enabled: enabled && !!appointmentId && !!currentOrganizationId,
    queryFn: async ({ signal }): Promise<ChargeProjection | null> => {
      const token = await getAccessToken();
      const res = await fetch(
        `/api/appointments/${appointmentId}/charge-projection?organization_id=${currentOrganizationId}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal,
        },
      );
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
  const { user, currentOrganizationId } = useAuth();
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
        // organizationId is required by the route's requireOrgAuth (400 without it).
        body: JSON.stringify({ organizationId: currentOrganizationId, reason }),
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

/**
 * Reads `organizations.require_job_photos` for the cleaner's current org.
 *
 * IMPORTANT: this is sourced from a dedicated query that actually SELECTs the
 * column. The org object on AuthContext only selects id, name, and the
 * branding/payout columns, so
 * `currentOrganization.require_job_photos` there always falls back to its default
 * (`true`) and would make the photo gate ignore an org that set it to `false`.
 * Reading it here avoids that trap. Defaults to `true` (gate required) while
 * loading, on error, or when the column is null — never silently bypass the gate.
 *
 * For a cleaner, `currentOrganizationId` is the org their appointments belong to
 * (one membership; appointments are org-scoped), so this matches the active job's org.
 */
export function useOrgRequireJobPhotos(): boolean {
  const { currentOrganizationId } = useAuth();
  const query = useQuery({
    queryKey: ['organization', 'require-job-photos', currentOrganizationId ?? ''] as const,
    enabled: !!currentOrganizationId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('organizations')
        .select('require_job_photos')
        .eq('id', currentOrganizationId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as { require_job_photos?: boolean } | null)?.require_job_photos ?? true;
    },
  });
  return query.data ?? true;
}
