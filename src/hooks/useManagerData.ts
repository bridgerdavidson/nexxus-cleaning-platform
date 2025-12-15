'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

// Manager interfaces (same as admin but focused on operations management)
export interface ManagerAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  special_requests?: string | null;
  notes?: string | null;
  homeowner: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  cleaner_profile?: {
    user_profile: {
      first_name: string;
      last_name: string;
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
}

export interface ManagerCleaner {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
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

  const fetchAppointments = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id,
          scheduled_date,
          scheduled_time,
          status,
          total_price,
          special_requests,
          notes,
          homeowner:user_profiles!homeowner_id(
            first_name,
            last_name,
            email
          ),
          cleaner_profile:cleaner_profiles(
            user_profile:user_profiles!id(
              first_name,
              last_name
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
        .eq('organization_id', currentOrganizationId)
        .order('scheduled_date', { ascending: false });

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedData = (data || []).map(appointment => ({
        ...appointment,
        homeowner: Array.isArray(appointment.homeowner) ? appointment.homeowner[0] : appointment.homeowner,
        property: Array.isArray(appointment.property) ? appointment.property[0] : appointment.property,
        service_type: Array.isArray(appointment.service_type) ? appointment.service_type[0] : appointment.service_type,
        cleaner_profile: appointment.cleaner_profile && Array.isArray(appointment.cleaner_profile) 
          ? {
              ...appointment.cleaner_profile[0],
              user_profile: Array.isArray(appointment.cleaner_profile[0]?.user_profile) 
                ? appointment.cleaner_profile[0].user_profile[0] 
                : appointment.cleaner_profile[0]?.user_profile
            }
          : appointment.cleaner_profile
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
            phone
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
        homeowner:user_profiles!homeowner_id(
          first_name,
          last_name,
          email
        ),
        cleaner_profile:cleaner_profiles(
          user_profile:user_profiles!id(
            first_name,
            last_name
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
        status: 'confirmed'
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

