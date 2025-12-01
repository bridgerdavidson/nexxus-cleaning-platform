'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

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
        
        // Transform the data to match our interface
        const transformedData = (data || []).map(appointment => ({
          ...appointment,
          homeowner: Array.isArray(appointment.homeowner) ? appointment.homeowner[0] : appointment.homeowner,
          property: Array.isArray(appointment.property) ? appointment.property[0] : appointment.property,
          service_type: Array.isArray(appointment.service_type) ? appointment.service_type[0] : appointment.service_type
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
