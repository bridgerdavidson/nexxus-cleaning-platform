'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useRealtimeAppointments } from './useRealtimeAppointments';
import { useOrgQuery } from '../lib/useOrgQuery';
import { keys } from '../lib/queryKeys';

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

export interface EarningsPayoutRow {
  id: string;
  amount: number;
  status: 'pending' | 'approved' | 'paid' | 'failed' | 'reversed' | 'bank_paid';
  paid_at: string | null;
  bank_paid_at: string | null;
  reversed_at: string | null;
  created_at: string;
  payout_percent_snapshot: number | null;
  appointment: {
    id: string;
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

export interface StripeSummaryData {
  inStripe: number;
  latestBankPayoutAmount: number | null;
  latestBankPayoutDate: string | null;
}

export interface EarningsSummary {
  projectedEarnings: number;
  inStripe: number;
  latestBankPayoutAmount: number | null;
  latestBankPayoutDate: string | null;
}

export interface CleanerEarningsData {
  summary: EarningsSummary;
  payoutHistory: EarningsPayoutRow[];
  loading: boolean;
  error: string | null;
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
  const [appointments, setAppointments] = useState<CleanerAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const { user, currentOrganizationId } = auth || {};
  const orgId = currentOrganizationId ?? null;

  // Helper function to fetch a single appointment with all relations
  const fetchSingleAppointment = useCallback(async (appointmentId: string): Promise<CleanerAppointment | null> => {
    if (!user?.id || !orgId) return null;

    try {
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
          )
        `)
        .eq('id', appointmentId)
        .eq('cleaner_id', user.id)
        .eq('organization_id', orgId)
        .single();

      if (error) {
        console.error('Error fetching appointment:', error);
        return null;
      }

      if (!data) return null;

      // Transform the data to match our interface
      return {
        ...data,
        homeowner: Array.isArray(data.homeowner) ? data.homeowner[0] : data.homeowner,
        property: Array.isArray(data.property) ? data.property[0] : data.property,
        service_type: Array.isArray(data.service_type) ? data.service_type[0] : data.service_type,
        checklist: Array.isArray(data.checklist) ? data.checklist[0] : data.checklist
      } as CleanerAppointment;
    } catch (err) {
      console.error('Error in fetchSingleAppointment:', err);
      return null;
    }
  }, [user?.id, orgId]);

  // Realtime callbacks
  const handleAppointmentInsert = useCallback(async (appointmentId: string) => {
    const appointment = await fetchSingleAppointment(appointmentId);
    if (appointment) {
      setAppointments(prev => {
        // Check if appointment already exists (avoid duplicates)
        if (prev.some(apt => apt.id === appointmentId)) {
          return prev;
        }
        // Add new appointment and sort by date
        return [...prev, appointment].sort((a, b) => {
          const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
          if (dateCompare !== 0) return dateCompare;
          return a.scheduled_time.localeCompare(b.scheduled_time);
        });
      });
    }
  }, [fetchSingleAppointment]);

  const handleAppointmentUpdate = useCallback(async (appointmentId: string) => {
    const appointment = await fetchSingleAppointment(appointmentId);
    if (appointment) {
      setAppointments(prev => {
        // Update existing appointment or add if not found
        const existingIndex = prev.findIndex(apt => apt.id === appointmentId);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = appointment;
          // Re-sort after update
          return updated.sort((a, b) => {
            const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
            if (dateCompare !== 0) return dateCompare;
            return a.scheduled_time.localeCompare(b.scheduled_time);
          });
        } else {
          // Appointment not in list, add it (might have been assigned to this cleaner)
          return [...prev, appointment].sort((a, b) => {
            const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
            if (dateCompare !== 0) return dateCompare;
            return a.scheduled_time.localeCompare(b.scheduled_time);
          });
        }
      });
    }
  }, [fetchSingleAppointment]);

  const handleAppointmentDelete = useCallback((appointmentId: string) => {
    setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
  }, []);

  // Set up realtime subscription
  useRealtimeAppointments({
    filters: {
      organizationId: orgId || '',
      cleanerId: user?.id,
    },
    onInsert: handleAppointmentInsert,
    onUpdate: handleAppointmentUpdate,
    onDelete: handleAppointmentDelete,
    enabled: !!user?.id && !!orgId,
  });

  useEffect(() => {
    if (!user?.id || !orgId) {
      setLoading(false);
      return;
    }

    const fetchAppointments = async () => {
      try {
        setLoading(true);
        
        // Check if cleaner profile exists for this user
        // Note: cleaner_profiles.id IS the user's id (no separate user_id column)
        const { data: cleanerProfile, error: profileError } = await supabase
          .from('cleaner_profiles')
          .select('id')
          .eq('id', user.id)
          .eq('organization_id', orgId)
          .single();

        if (profileError) {
          console.error('Cleaner profile error:', profileError);
          throw profileError;
        }
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
            )
          `)
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId)
          .order('scheduled_date', { ascending: true });
        
        if (error) throw error;
        
        // Fetch payment statuses for all appointments
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

        // Transform the data to match our interface
        const transformedData = (data || []).map(appointment => ({
          ...appointment,
          homeowner: Array.isArray(appointment.homeowner) ? appointment.homeowner[0] : appointment.homeowner,
          property: Array.isArray(appointment.property) ? appointment.property[0] : appointment.property,
          service_type: Array.isArray(appointment.service_type) ? appointment.service_type[0] : appointment.service_type,
          checklist: Array.isArray(appointment.checklist) ? appointment.checklist[0] : appointment.checklist,
          payment_status: paymentStatusMap[appointment.id] || null,
        }));
        
        setAppointments(transformedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch appointments');
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [user?.id, orgId]);

  return { appointments, loading, error };
}

export function useCleanerStats() {
  const [stats, setStats] = useState<CleanerStats>({
    totalJobs: 0,
    completedThisWeek: 0,
    totalEarnings: 0,
    pendingPayouts: 0,
    completedJobs: 0,
    upcomingJobs: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const { user, currentOrganizationId } = auth || {};
  const orgId = currentOrganizationId ?? null;

  useEffect(() => {
    if (!user?.id || !orgId) {
      setLoading(false);
      return;
    }

    const fetchStats = async () => {
      try {
        setLoading(true);

        // Note: cleaner_profiles.id IS the user's id
        const { data: cleanerProfile, error: profileError } = await supabase
          .from('cleaner_profiles')
          .select('id, payout_percent')
          .eq('id', user.id)
          .eq('organization_id', orgId)
          .single();

        if (profileError) throw profileError;
        if (!cleanerProfile) throw new Error('Cleaner profile not found');

        // Get total jobs count
        const { count: totalJobs } = await supabase
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId);

        // Get completed jobs count
        const { count: completedJobs } = await supabase
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId)
          .eq('status', 'completed');

        // Get upcoming jobs count
        const { count: upcomingJobs } = await supabase
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId)
          .in('status', ['pending', 'confirmed', 'in_progress']);

        // Get jobs completed this week
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        const { count: completedThisWeek } = await supabase
          .from('appointments')
          .select('*', { count: 'exact', head: true })
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId)
          .eq('status', 'completed')
          .gte('scheduled_date', oneWeekAgo.toISOString().split('T')[0]);

        // Get total earnings from completed jobs
        const { data: completedAppointments } = await supabase
          .from('appointments')
          .select('id, total_price')
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId)
          .eq('status', 'completed');

        const totalEarnings = completedAppointments?.reduce((sum, appointment) => 
          sum + Number(appointment.total_price), 0) || 0;

        const payoutPercent = Number(cleanerProfile.payout_percent) || 0;
        const cleanerEarnings = totalEarnings * (payoutPercent / 100);
        
        // Get already paid amounts
        const { data: payouts } = await supabase
          .from('payments')
          .select('amount')
          .eq('organization_id', orgId)
          .eq('status', 'paid')
          .in('appointment_id', completedAppointments?.map(a => a.id) || []);

        const paidAmount = payouts?.reduce((sum, payout) => sum + Number(payout.amount), 0) || 0;
        const pendingPayouts = Math.max(0, cleanerEarnings - paidAmount);

        setStats({
          totalJobs: totalJobs || 0,
          completedThisWeek: completedThisWeek || 0,
          totalEarnings: Math.round(cleanerEarnings),
          pendingPayouts: Math.round(pendingPayouts),
          completedJobs: completedJobs || 0,
          upcomingJobs: upcomingJobs || 0
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch stats');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [user?.id, orgId]);

  return { stats, loading, error };
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

/**
 * Projected earnings for a date range: sum of cleaner share for appointments
 * that are confirmed, in progress, or completed in the window (pending and
 * cancelled excluded). Only queries appointments — no Stripe calls, no reconcile.
 */
export function useCleanerProjectedEarnings(startDate: string, endDate: string) {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: keys.cleanerEarnings.projected(userId, startDate, endDate),
    queryFn: async ({ orgId, userId }) => {
      const { data: cleanerProfile, error: profileError } = await supabase
        .from('cleaner_profiles')
        .select('id, payout_percent')
        .eq('id', userId)
        .eq('organization_id', orgId)
        .single();
      if (profileError) throw profileError;
      if (!cleanerProfile) throw new Error('Cleaner profile not found');

      const payoutPercent = Number(cleanerProfile.payout_percent) || 0;
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const effectiveStart = startDate < todayStr ? todayStr : startDate;
      if (effectiveStart > endDate) return 0;

      const { data: periodAppointments } = await supabase
        .from('appointments')
        .select('id, total_price')
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId)
        .in('status', ['confirmed', 'in_progress', 'completed'])
        .gte('scheduled_date', effectiveStart)
        .lte('scheduled_date', endDate);

      const grossTotal = (periodAppointments || []).reduce(
        (sum, a) => sum + Number(a.total_price), 0,
      );
      return Math.round(grossTotal * (payoutPercent / 100) * 100) / 100;
    },
  });

  return {
    projectedEarnings: query.data ?? 0,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

/**
 * Live Stripe summary (In Stripe balance + latest bank payout).
 * Fetched once on mount — period-independent so it never re-fetches when
 * the user changes projected-earnings or history date ranges.
 * Also kicks off reconcile in parallel to keep DB history accurate.
 */
export function useCleanerStripeSummary() {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: keys.cleanerEarnings.summary(userId),
    queryFn: async ({ orgId, userId, accessToken }) => {
      const reconcilePromise = fetch('/api/stripe/connect/reconcile-payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ cleaner_id: userId }),
      }).catch((err: unknown) => console.warn('Earnings reconcile failed (non-fatal):', err));

      const stripeSummaryPromise = fetch('/api/stripe/connect/balance-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ cleaner_id: userId }),
      })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);

      const [, stripeSummary] = await Promise.all([reconcilePromise, stripeSummaryPromise]);

      let inStripe = 0;
      let latestBankPayoutAmount: number | null = null;
      let latestBankPayoutDate: string | null = null;

      if (stripeSummary?.success) {
        inStripe = Number(stripeSummary.availableBalance) + Number(stripeSummary.pendingBalance);
        if (stripeSummary.latestPayout) {
          latestBankPayoutAmount = Number(stripeSummary.latestPayout.amount);
          latestBankPayoutDate = stripeSummary.latestPayout.date;
        }
      } else {
        const { data: inStripeData } = await supabase
          .from('payouts').select('amount')
          .eq('cleaner_id', userId).eq('organization_id', orgId).eq('status', 'paid');
        inStripe = (inStripeData || []).reduce((sum, r) => sum + Number(r.amount), 0);

        const { data: latestBankData } = await supabase
          .from('payouts').select('amount, bank_paid_at')
          .eq('cleaner_id', userId).eq('organization_id', orgId).eq('status', 'bank_paid')
          .order('bank_paid_at', { ascending: false }).limit(1);
        const latestBank = latestBankData?.[0] ?? null;
        if (latestBank) {
          latestBankPayoutAmount = Math.round(Number(latestBank.amount) * 100) / 100;
          latestBankPayoutDate = latestBank.bank_paid_at ?? null;
        }
      }

      return {
        inStripe: Math.round(inStripe * 100) / 100,
        latestBankPayoutAmount:
          latestBankPayoutAmount != null
            ? Math.round(latestBankPayoutAmount * 100) / 100
            : null,
        latestBankPayoutDate,
      } as StripeSummaryData;
    },
  });

  const data = query.data ?? {
    inStripe: 0,
    latestBankPayoutAmount: null,
    latestBankPayoutDate: null,
  };

  return {
    ...data,
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

/**
 * Payout history filtered by paid_at date range.
 * Changing history period only re-fetches history rows — no Stripe calls.
 */
export function useCleanerEarningsHistory(startDate: string, endDate: string) {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const query = useOrgQuery({
    queryKey: keys.cleanerEarnings.history(userId, startDate, endDate),
    queryFn: async ({ orgId, userId }) => {
      const { data: payoutsData, error: payoutsError } = await supabase
        .from('payouts')
        .select(`
          id, amount, status, paid_at, bank_paid_at, reversed_at, created_at,
          payout_percent_snapshot,
          appointment:appointments(
            id, scheduled_date,
            homeowner:user_profiles!homeowner_id(first_name, last_name),
            service_type:service_types(name)
          )
        `)
        .eq('cleaner_id', userId)
        .eq('organization_id', orgId)
        .gte('paid_at', `${startDate}T00:00:00`)
        .lte('paid_at', `${endDate}T23:59:59`)
        .order('paid_at', { ascending: false });

      if (payoutsError) throw payoutsError;

      return (payoutsData || []).map((p: Record<string, unknown>) => {
        const apptRaw = p.appointment;
        let appointment: EarningsPayoutRow['appointment'] = null;
        if (apptRaw) {
          const appt = Array.isArray(apptRaw) ? apptRaw[0] : apptRaw;
          if (appt) {
            appointment = {
              id: appt.id as string,
              scheduled_date: appt.scheduled_date as string,
              homeowner: Array.isArray(appt.homeowner) ? appt.homeowner[0] : appt.homeowner,
              service_type: Array.isArray(appt.service_type) ? appt.service_type[0] : appt.service_type,
            };
          }
        }
        return {
          id: p.id as string,
          amount: Number(p.amount),
          status: p.status as EarningsPayoutRow['status'],
          paid_at: p.paid_at as string | null,
          bank_paid_at: p.bank_paid_at as string | null,
          reversed_at: p.reversed_at as string | null,
          created_at: p.created_at as string,
          payout_percent_snapshot: p.payout_percent_snapshot != null ? Number(p.payout_percent_snapshot) : null,
          appointment,
        } as EarningsPayoutRow;
      });
    },
  });

  return {
    payoutHistory: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

/**
 * Legacy combined hook — kept for backward compatibility but now delegates
 * to the three independent hooks internally.
 */
export function useCleanerEarnings(
  summaryStart: string,
  summaryEnd: string,
  historyStart: string,
  historyEnd: string,
) {
  const { projectedEarnings, loading: projLoading, error: projError } = useCleanerProjectedEarnings(summaryStart, summaryEnd);
  const { inStripe, latestBankPayoutAmount, latestBankPayoutDate, loading: stripeLoading, error: stripeError } = useCleanerStripeSummary();
  const { payoutHistory, loading: histLoading, error: histError } = useCleanerEarningsHistory(historyStart, historyEnd);

  const summary: EarningsSummary = {
    projectedEarnings,
    inStripe,
    latestBankPayoutAmount,
    latestBankPayoutDate,
  };

  return {
    summary,
    payoutHistory,
    loading: projLoading || stripeLoading || histLoading,
    error: projError || stripeError || histError,
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

  return {
    photos: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

// Helper function to update appointment status
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

    // If status changed to 'completed', trigger automatic payment
    if (status === 'completed') {
      try {
        // Get appointment details for organization_id
        const { data: appointment } = await supabase
          .from('appointments')
          .select('organization_id')
          .eq('id', appointmentId)
          .single();

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
    lineItems: query.data?.lineItems ?? [],
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
