'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useRealtimeAppointments } from './useRealtimeAppointments';

export interface CleanerAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  special_requests?: string;
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
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
}

export interface CleanerStats {
  totalJobs: number;
  completedThisWeek: number;
  totalEarnings: number;
  pendingPayouts: number;
  rating: number;
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
          scheduled_date,
          scheduled_time,
          status,
          total_price,
          special_requests,
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
        service_type: Array.isArray(data.service_type) ? data.service_type[0] : data.service_type
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
            scheduled_date,
            scheduled_time,
            status,
            total_price,
            special_requests,
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
    rating: 0,
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

        // First get the cleaner profile
        // Note: cleaner_profiles.id IS the user's id
        const { data: cleanerProfile, error: profileError } = await supabase
          .from('cleaner_profiles')
          .select('id, rating, total_jobs')
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

        // Get pending payouts (assuming 80% goes to cleaner, 20% to platform)
        const cleanerEarnings = totalEarnings * 0.8;
        
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
          rating: cleanerProfile.rating || 0,
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
  const [messages, setMessages] = useState<CleanerMessage[]>([]);
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
            )
          `)
          .eq('organization_id', orgId)
          .eq('recipient_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        
        // Transform the data to match our interface
        const transformedData = (data || []).map(message => ({
          ...message,
          sender: Array.isArray(message.sender) ? message.sender[0] : message.sender
        }));
        
        setMessages(transformedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch messages');
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [user?.id, orgId]);

  return { messages, loading, error };
}

export function useCleanerPayouts() {
  const [payouts, setPayouts] = useState<CleanerPayout[]>([]);
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

    const fetchPayouts = async () => {
      try {
        setLoading(true);
        
        // Note: cleaner_profiles.id IS the user's id
        const { data: cleanerProfile, error: profileError } = await supabase
          .from('cleaner_profiles')
          .select('id')
          .eq('id', user.id)
          .eq('organization_id', orgId)
          .single();

        if (profileError) throw profileError;
        if (!cleanerProfile) throw new Error('Cleaner profile not found');

        // Get appointments for this cleaner to find related payments
        const { data: appointments } = await supabase
          .from('appointments')
          .select('id')
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId);

        if (!appointments || appointments.length === 0) {
          setPayouts([]);
          return;
        }

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
        
        setPayouts(transformedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch payouts');
      } finally {
        setLoading(false);
      }
    };

    fetchPayouts();
  }, [user?.id, orgId]);

  return { payouts, loading, error };
}

export function useCleanerPhotos() {
  const [photos, setPhotos] = useState<CleanerPhoto[]>([]);
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

    const fetchPhotos = async () => {
      try {
        setLoading(true);
        
        // Note: cleaner_profiles.id IS the user's id
        const { data: cleanerProfile, error: profileError } = await supabase
          .from('cleaner_profiles')
          .select('id')
          .eq('id', user.id)
          .eq('organization_id', orgId)
          .single();

        if (profileError) throw profileError;
        if (!cleanerProfile) throw new Error('Cleaner profile not found');

        // Get appointments for this cleaner to find related photos
        const { data: appointments } = await supabase
          .from('appointments')
          .select('id')
          .eq('cleaner_id', user.id)
          .eq('organization_id', orgId);

        if (!appointments || appointments.length === 0) {
          setPhotos([]);
          return;
        }

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
        
        // Transform the data to match our interface
        const transformedData = (data || []).map(photo => ({
          ...photo,
          appointment: Array.isArray(photo.appointment) 
            ? {
                ...photo.appointment[0],
                homeowner: Array.isArray(photo.appointment[0]?.homeowner) 
                  ? photo.appointment[0].homeowner[0] 
                  : photo.appointment[0]?.homeowner
              }
            : photo.appointment
        }));
        
        setPhotos(transformedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch photos');
      } finally {
        setLoading(false);
      }
    };

    fetchPhotos();
  }, [user?.id, orgId]);

  return { photos, loading, error };
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

        const result = await response.json();

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

// Helper function to upload job photo
export async function uploadJobPhoto(appointmentId: string, file: File, photoType: 'before' | 'after' | 'during') {
  try {
    // Upload file to Supabase Storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${appointmentId}_${photoType}_${Date.now()}.${fileExt}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('job-photos')
      .getPublicUrl(fileName);

    // Save photo record to database
    const { error: dbError } = await supabase
      .from('job_photos')
      .insert({
        appointment_id: appointmentId,
        photo_url: publicUrl,
        photo_type: photoType
      });

    if (dbError) throw dbError;

    return { success: true, url: publicUrl };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to upload photo' };
  }
}
