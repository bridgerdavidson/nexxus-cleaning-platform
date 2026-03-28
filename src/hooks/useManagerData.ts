'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useRealtimeAppointments } from './useRealtimeAppointments';
import { useRealtimePayments, PaymentUpdateData } from './useRealtimePayments';

// Manager interfaces (same as admin but focused on operations management)
export interface ManagerAppointment {
  id: string;
  service_type_id?: string;
  checklist_id?: string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  special_requests?: string | null;
  notes?: string | null;
  cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected';
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
  const [appointments, setAppointments] = useState<ManagerAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  // Helper function to fetch a single appointment with all relations
  const fetchSingleAppointment = useCallback(async (appointmentId: string): Promise<ManagerAppointment | null> => {
    if (!currentOrganizationId) return null;

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
          total_price,
          special_requests,
          notes,
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
        .eq('id', appointmentId)
        .eq('organization_id', currentOrganizationId)
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
        checklist: Array.isArray(data.checklist) ? data.checklist[0] : data.checklist,
        cleaner_profile: data.cleaner_profile && Array.isArray(data.cleaner_profile) 
          ? {
              ...data.cleaner_profile[0],
              user_profile: Array.isArray(data.cleaner_profile[0]?.user_profile) 
                ? data.cleaner_profile[0].user_profile[0] 
                : data.cleaner_profile[0]?.user_profile
            }
          : data.cleaner_profile
      } as ManagerAppointment;
    } catch (err) {
      console.error('Error in fetchSingleAppointment:', err);
      return null;
    }
  }, [currentOrganizationId]);

  // Realtime callbacks
  const handleAppointmentInsert = useCallback(async (appointmentId: string) => {
    const appointment = await fetchSingleAppointment(appointmentId);
    if (appointment) {
      setAppointments(prev => {
        // Check if appointment already exists (avoid duplicates)
        if (prev.some(apt => apt.id === appointmentId)) {
          return prev;
        }
        // Add new appointment and sort by date (descending for manager view)
        return [...prev, appointment].sort((a, b) => {
          const dateCompare = b.scheduled_date.localeCompare(a.scheduled_date);
          if (dateCompare !== 0) return dateCompare;
          return b.scheduled_time.localeCompare(a.scheduled_time);
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
            const dateCompare = b.scheduled_date.localeCompare(a.scheduled_date);
            if (dateCompare !== 0) return dateCompare;
            return b.scheduled_time.localeCompare(a.scheduled_time);
          });
        } else {
          // Appointment not in list, add it
          return [...prev, appointment].sort((a, b) => {
            const dateCompare = b.scheduled_date.localeCompare(a.scheduled_date);
            if (dateCompare !== 0) return dateCompare;
            return b.scheduled_time.localeCompare(a.scheduled_time);
          });
        }
      });
    }
  }, [fetchSingleAppointment]);

  const handleAppointmentDelete = useCallback((appointmentId: string) => {
    setAppointments(prev => prev.filter(apt => apt.id !== appointmentId));
  }, []);

  // Handle payment status updates from realtime subscription
  const handlePaymentUpdate = useCallback((data: PaymentUpdateData) => {
    setAppointments(prev => 
      prev.map(apt => 
        apt.id === data.appointmentId 
          ? { ...apt, payment_status: data.status }
          : apt
      )
    );
  }, []);

  // Set up realtime subscription for appointments
  useRealtimeAppointments({
    filters: {
      organizationId: currentOrganizationId || '',
    },
    onInsert: handleAppointmentInsert,
    onUpdate: handleAppointmentUpdate,
    onDelete: handleAppointmentDelete,
    enabled: !!currentOrganizationId,
  });

  // Set up realtime subscription for payments
  useRealtimePayments({
    onPaymentUpdate: handlePaymentUpdate,
    enabled: !!currentOrganizationId,
  });

  const fetchAppointments = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('appointments')
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
          cleaner_confirmation_status,
          price_override_enabled,
          price_override_total,
          homeowner_id,
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
        .eq('organization_id', currentOrganizationId)
        .order('scheduled_date', { ascending: false });

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
        cleaner_profile: appointment.cleaner_profile && Array.isArray(appointment.cleaner_profile) 
          ? {
              ...appointment.cleaner_profile[0],
              user_profile: Array.isArray(appointment.cleaner_profile[0]?.user_profile) 
                ? appointment.cleaner_profile[0].user_profile[0] 
                : appointment.cleaner_profile[0]?.user_profile
            }
          : appointment.cleaner_profile,
        payment_status: paymentStatusMap[appointment.id] || null,
      }));
      
      setAppointments(transformedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch appointments');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const refetch = useCallback(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Update a single appointment in state without refetching
  const updateAppointmentInState = useCallback((appointmentId: string, updatedData: Partial<ManagerAppointment>) => {
    setAppointments(prevAppointments => 
      prevAppointments.map(appointment => 
        appointment.id === appointmentId 
          ? { ...appointment, ...updatedData }
          : appointment
      )
    );
  }, []);

  return { appointments, loading, error, refetch, updateAppointmentInState };
}

export function useManagerCleaners() {
  const [cleaners, setCleaners] = useState<ManagerCleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchCleaners = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
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
          user_profile:user_profiles!id(
            first_name,
            last_name,
            email,
            phone,
            avatar_url
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .order('total_jobs', { ascending: false });

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedData = (data || []).map(cleaner => ({
        ...cleaner,
        user_profile: Array.isArray(cleaner.user_profile) ? cleaner.user_profile[0] : cleaner.user_profile
      }));
      
      setCleaners(transformedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cleaners');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchCleaners();
  }, [fetchCleaners]);

  // Update a single cleaner in state without refetching
  const updateCleanerInState = useCallback((cleanerId: string, updatedData: Partial<ManagerCleaner>) => {
    setCleaners(prevCleaners => 
      prevCleaners.map(cleaner => 
        cleaner.id === cleanerId 
          ? { ...cleaner, ...updatedData }
          : cleaner
      )
    );
  }, []);

  return { cleaners, loading, error, refetch: fetchCleaners, updateCleanerInState };
}

export function useManagerPayments() {
  const [payments, setPayments] = useState<ManagerPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  useEffect(() => {
    if (!user?.id || !currentOrganizationId) return;

    const fetchPayments = async () => {
      try {
        setLoading(true);
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
          .eq('organization_id', currentOrganizationId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Transform the data to match our interface
        const transformedData = (data || []).map(payment => ({
          ...payment,
          appointment: Array.isArray(payment.appointment) 
            ? {
                ...payment.appointment[0],
                homeowner: Array.isArray(payment.appointment[0]?.homeowner) 
                  ? payment.appointment[0].homeowner[0] 
                  : payment.appointment[0]?.homeowner,
                service_type: Array.isArray(payment.appointment[0]?.service_type) 
                  ? payment.appointment[0].service_type[0] 
                  : payment.appointment[0]?.service_type
              }
            : payment.appointment
        }));
        
        setPayments(transformedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch payments');
      } finally {
        setLoading(false);
      }
    };

    fetchPayments();
  }, [user?.id, currentOrganizationId]);

  return { payments, loading, error };
}

export function useManagerMessages() {
  const [messages, setMessages] = useState<ManagerMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  useEffect(() => {
    if (!user?.id || !currentOrganizationId) return;

    const fetchMessages = async () => {
      try {
        setLoading(true);
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
          .eq('organization_id', currentOrganizationId)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Transform the data to match our interface
        const transformedData = (data || []).map(message => ({
          ...message,
          sender: Array.isArray(message.sender) ? message.sender[0] : message.sender,
          recipient: Array.isArray(message.recipient) ? message.recipient[0] : message.recipient
        }));
        
        setMessages(transformedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch messages');
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [user?.id, currentOrganizationId]);

  return { messages, loading, error };
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
    const response = await fetch(`/api/admin/delete-cleaner?id=${encodeURIComponent(cleanerId)}`, {
      method: 'DELETE',
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

