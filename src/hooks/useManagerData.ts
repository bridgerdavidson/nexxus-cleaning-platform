'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { stripeNewChargeFlowUiEnabled } from '../lib/stripe/flags';
import { chargeCompletedAppointmentClient } from '../lib/payments/authorizeClient';

// Manager interfaces (same as admin but focused on operations management)
export interface ManagerAppointment {
  id: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  /** Length of the appointment in minutes (DB column). */
  duration_minutes?: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  special_requests?: string | null;
  notes?: string | null;
  cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected';
  /** cleaner_profiles.id of the assigned cleaner (= the user id). Null when unassigned. */
  cleaner_id?: string | null;
  /** Wave 2 SLA: deadline for cleaner response. Null once cleaner responds. */
  response_deadline?: string | null;
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
  /** Card-hold (authorization) lifecycle for the new charge flow (migration 065). */
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
}

export interface ManagerCleaner {
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
  stripe_connect_account_id?: string | null;
  stripe_connect_onboarding_complete?: boolean;
}

export interface ManagerPayment {
  id: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
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

export interface ManagerMessage {
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

export function useManagerAppointments() {
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
          service_type_id,
          checklist_id,
          scheduled_date,
          scheduled_time,
          duration_minutes,
          status,
          total_price,
          authorization_status,
          special_requests,
          notes,
          cleaner_confirmation_status,
          response_deadline,
          price_override_enabled,
          price_override_total,
          homeowner_id,
          cleaner_id,
          homeowner:user_profiles!homeowner_id(
            first_name,
            last_name,
            phone,
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
      })) as ManagerAppointment[];
    },
  });

  // Channel name matches admin's so the two consumers share one subscription.
  // We also invalidate stats keys here so dashboards stay live.
  useSupabaseRealtimeSync({
    channelName: `appointments:${orgId}`,
    table: 'appointments',
    filter: orgId ? `organization_id=eq.${orgId}` : undefined,
    enabled: !!orgId,
    onEvent: () => ({
      type: 'invalidate',
      keys: [queryKey, keys.stats.admin(orgId), keys.customers.byOrg(orgId)],
    }),
  });

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
            const list = Array.isArray(prev) ? (prev as ManagerAppointment[]) : [];
            return list.map(a =>
              a.id === apptId
                ? { ...a, payment_status: (row?.status as ManagerAppointment['payment_status']) ?? a.payment_status }
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
    (appointmentId: string, updatedData: Partial<ManagerAppointment>) => {
      queryClient.setQueryData<ManagerAppointment[]>(queryKey, prev =>
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

export function useManagerCleaners() {
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
      })) as ManagerCleaner[];
    },
  });

  // Org-shared cleaner_profiles channel (same name as useAdminCleaners so they
  // share one underlying subscription).
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
    (cleanerId: string, updatedData: Partial<ManagerCleaner>) => {
      queryClient.setQueryData<ManagerCleaner[]>(queryKey, prev =>
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

export function useManagerPayments() {
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
      })) as ManagerPayment[];
    },
  });

  return {
    payments: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
  };
}

export function useManagerMessages() {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';

  const query = useOrgQuery({
    queryKey: ['messages', 'manager', orgId] as const,
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
        recipient: Array.isArray(message.recipient) ? message.recipient[0] : message.recipient,
      })) as ManagerMessage[];
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

// Helper function to update a full appointment
export async function updateAppointment(
  appointmentId: string,
  data: {
    scheduled_date?: string;
    scheduled_time?: string;
    service_type_id?: string;
    property_id?: string;
    cleaner_id?: string | null;
    total_price?: number;
    special_requests?: string | null;
    notes?: string | null;
    status?: string;
  }
): Promise<{ success: boolean; data?: ManagerAppointment; error?: string }> {
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
        scheduled_date,
        scheduled_time,
        status,
        total_price,
        special_requests,
        notes,
        cleaner_confirmation_status,
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
        )
      `)
      .single();

    if (error) {
      console.error('Error updating appointment:', error);
      throw error;
    }
    
    if (!updateData) {
      console.warn('No rows updated for appointment:', appointmentId);
      return { success: false, error: 'No rows were updated. This may be due to RLS policies.' };
    }
    
    // Transform the data to match our interface
    const transformedData = {
      ...updateData,
      homeowner: Array.isArray(updateData.homeowner) ? updateData.homeowner[0] : updateData.homeowner,
      property: Array.isArray(updateData.property) ? updateData.property[0] : updateData.property,
      service_type: Array.isArray(updateData.service_type) ? updateData.service_type[0] : updateData.service_type,
      cleaner_profile: updateData.cleaner_profile && Array.isArray(updateData.cleaner_profile) 
        ? {
            ...updateData.cleaner_profile[0],
            user_profile: Array.isArray(updateData.cleaner_profile[0]?.user_profile) 
              ? updateData.cleaner_profile[0].user_profile[0] 
              : updateData.cleaner_profile[0]?.user_profile
          }
        : updateData.cleaner_profile
    };
    
    return { success: true, data: transformedData as ManagerAppointment };
  } catch (error) {
    console.error('Failed to update appointment:', error);
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

// Helper function to update cleaner availability
export async function updateCleanerAvailability(cleanerId: string, isAvailable: boolean) {
  try {
    const { error } = await supabase
      .from('cleaner_profiles')
      .update({ is_available: isAvailable })
      .eq('id', cleanerId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update cleaner availability' };
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

// Helper function to permanently delete an appointment (hard delete)
export async function deleteAppointment(appointmentId: string) {
  try {
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', appointmentId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete appointment' };
  }
}

