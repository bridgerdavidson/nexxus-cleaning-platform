'use client';

import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';

export interface Appointment {
  id: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
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

  const query = useOrgQuery({
    queryKey,
    queryFn: async ({ orgId, userId }) => {
      const { data, error: fetchError } = await supabase
        .from('appointments')
        .select(`
          id,
          service_type_id,
          checklist_id,
          scheduled_date,
          scheduled_time,
          status,
          total_price,
          job_progress,
          started_at,
          completed_at,
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
              last_name
            )
          )
        `)
        .eq('homeowner_id', userId)
        .eq('organization_id', orgId)
        .order('scheduled_date', { ascending: true });

      if (fetchError) throw fetchError;

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

  return {
    appointments: query.data ?? [],
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
  };
}
