'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useRealtimeAppointments } from './useRealtimeAppointments';
import { useRealtimePayments, PaymentUpdateData } from './useRealtimePayments';

export interface AdminAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  special_requests?: string | null;
  notes?: string | null;
  series_id?: string | null;
  cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected';
  homeowner_id?: string;
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
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded' | null;
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
  const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  // Helper function to fetch a single appointment with all relations
  const fetchSingleAppointment = useCallback(async (appointmentId: string): Promise<AdminAppointment | null> => {
    if (!currentOrganizationId) return null;

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
          notes,
          series_id,
          cleaner_confirmation_status,
          homeowner_id,
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
        .eq('id', appointmentId)
        .eq('organization_id', currentOrganizationId)
        .single();

      if (error) {
        return null;
      }

      if (!data) return null;

      // Transform the data to match our interface
      return {
        ...data,
        homeowner: Array.isArray(data.homeowner) ? data.homeowner[0] : data.homeowner,
        property: Array.isArray(data.property) ? data.property[0] : data.property,
        service_type: Array.isArray(data.service_type) ? data.service_type[0] : data.service_type,
        cleaner_profile: data.cleaner_profile && Array.isArray(data.cleaner_profile) 
          ? {
              ...data.cleaner_profile[0],
              user_profile: Array.isArray(data.cleaner_profile[0]?.user_profile) 
                ? data.cleaner_profile[0].user_profile[0] 
                : data.cleaner_profile[0]?.user_profile
            }
          : data.cleaner_profile
      } as AdminAppointment;
    } catch (err) {
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
        // Add new appointment and sort by date (descending for admin view)
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
          scheduled_date,
          scheduled_time,
          status,
          total_price,
          special_requests,
          notes,
          series_id,
          cleaner_confirmation_status,
          homeowner_id,
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

      if (error) {
        throw error;
      }
      
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
  const updateAppointmentInState = useCallback((appointmentId: string, updatedData: Partial<AdminAppointment>) => {
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

export function useAdminCleaners() {
  const [cleaners, setCleaners] = useState<AdminCleaner[]>([]);
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
  const updateCleanerInState = useCallback((cleanerId: string, updatedData: Partial<AdminCleaner>) => {
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

export function useAdminStats() {
  const [stats, setStats] = useState<AdminStats>({
    totalBookings: 0,
    activeCleaners: 0,
    totalRevenue: 0,
    pendingApprovals: 0,
    monthlyGrowth: 0,
    completionRate: 0,
    avgRating: 0,
    avgJobsPerDay: 0,
    avgJobValue: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchStats = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);

      // Get total bookings
      const { count: totalBookings } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', currentOrganizationId);

      // Get active cleaners
      const { count: activeCleaners } = await supabase
        .from('cleaner_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', currentOrganizationId)
        .eq('is_available', true);

      // Get pending approvals
      const { count: pendingApprovals } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', currentOrganizationId)
        .eq('status', 'pending');

      // Get total revenue from paid payments
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('organization_id', currentOrganizationId)
        .eq('status', 'paid');

      const totalRevenue = payments?.reduce((sum, payment) => sum + Number(payment.amount), 0) || 0;

      // Get completion rate
      const { count: completedJobs } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', currentOrganizationId)
        .eq('status', 'completed');

      const completionRate = totalBookings ? (completedJobs || 0) / totalBookings * 100 : 0;

      // Get average rating from reviews
      const { data: reviews } = await supabase
        .from('reviews')
        .select('rating')
        .eq('organization_id', currentOrganizationId);

      const avgRating = reviews?.length ? 
        reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;

      // Calculate average job value
      const avgJobValue = totalBookings ? totalRevenue / totalBookings : 0;

      // Calculate jobs per day (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { count: recentJobs } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', currentOrganizationId)
        .gte('created_at', thirtyDaysAgo.toISOString());

      const avgJobsPerDay = (recentJobs || 0) / 30;

      // Calculate monthly growth (simplified - would need historical data for real calculation)
      const monthlyGrowth = 15.3; // Placeholder

      setStats({
        totalBookings: totalBookings || 0,
        activeCleaners: activeCleaners || 0,
        totalRevenue,
        pendingApprovals: pendingApprovals || 0,
        monthlyGrowth,
        completionRate: Math.round(completionRate * 10) / 10,
        avgRating: Math.round(avgRating * 10) / 10,
        avgJobsPerDay: Math.round(avgJobsPerDay * 10) / 10,
        avgJobValue: Math.round(avgJobValue)
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const refetch = useCallback(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch };
}

export function useAdminPayments() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchPayments = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id,
          amount,
          status,
          payment_type,
          payment_method,
          reference,
          notes,
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
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  return { payments, loading, error, refetch: fetchPayments };
}

export interface AdminPayout {
  id: string;
  amount: number;
  status: 'pending' | 'approved' | 'paid' | 'failed';
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
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchPayouts = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('payouts')
        .select(`
          id,
          amount,
          status,
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
        .eq('organization_id', currentOrganizationId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedData = (data || []).map(payout => {
        const cleanerData = Array.isArray(payout.cleaner) ? payout.cleaner[0] : payout.cleaner;
        const userProfile = cleanerData?.user_profile;
        const userProfileData = Array.isArray(userProfile) ? userProfile[0] : userProfile;
        
        return {
          ...payout,
          cleaner: userProfileData || null,
          appointment: Array.isArray(payout.appointment) 
            ? payout.appointment[0] 
            : payout.appointment
        };
      });
      
      setPayouts(transformedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch payouts');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchPayouts();
  }, [fetchPayouts]);

  return { payouts, loading, error, refetch: fetchPayouts };
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
  const [invoices, setInvoices] = useState<AdminInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchInvoices = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
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
        .eq('organization_id', currentOrganizationId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedData = (data || []).map(invoice => ({
        ...invoice,
        homeowner: Array.isArray(invoice.homeowner) 
          ? invoice.homeowner[0] 
          : invoice.homeowner
      }));
      
      setInvoices(transformedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch invoices');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  return { invoices, loading, error, refetch: fetchInvoices };
}

export interface PaymentStats {
  totalRevenue: number;
  pendingPayouts: number;
  thisMonthRevenue: number;
}

export function usePaymentStats() {
  const [stats, setStats] = useState<PaymentStats>({
    totalRevenue: 0,
    pendingPayouts: 0,
    thisMonthRevenue: 0,
  });
  const [loading, setLoading] = useState(true);
  const { user, currentOrganizationId } = useAuth();

  useEffect(() => {
    if (!user?.id || !currentOrganizationId) return;

    const fetchStats = async () => {
      try {
        setLoading(true);

        // Get total revenue from payments (status = 'paid' and type = 'revenue')
        const { data: revenueData } = await supabase
          .from('payments')
          .select('amount')
          .eq('organization_id', currentOrganizationId)
          .eq('status', 'paid')
          .eq('payment_type', 'revenue');

        const totalRevenue = (revenueData || []).reduce((sum, p) => sum + Number(p.amount), 0);

        // Get pending payouts
        const { data: payoutsData } = await supabase
          .from('payouts')
          .select('amount')
          .eq('organization_id', currentOrganizationId)
          .eq('status', 'pending');

        const pendingPayouts = (payoutsData || []).reduce((sum, p) => sum + Number(p.amount), 0);

        // Get this month's revenue
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        
        const { data: monthData } = await supabase
          .from('payments')
          .select('amount')
          .eq('organization_id', currentOrganizationId)
          .eq('status', 'paid')
          .eq('payment_type', 'revenue')
          .gte('created_at', firstDayOfMonth);

        const thisMonthRevenue = (monthData || []).reduce((sum, p) => sum + Number(p.amount), 0);

        setStats({
          totalRevenue: Math.round(totalRevenue),
          pendingPayouts: Math.round(pendingPayouts),
          thisMonthRevenue: Math.round(thisMonthRevenue),
        });
      } catch (err) {
        // Error handled silently
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [user?.id, currentOrganizationId]);

  return { stats, loading };
}

export function useAdminMessages() {
  const [messages, setMessages] = useState<AdminMessage[]>([]);
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
        } catch {
          // Don't fail the status update, just log the payment error
          return { 
            success: true, 
            paymentStatus: 'failed',
            paymentError: 'Failed to parse payment response'
          };
        }

        if (!response.ok) {
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
    cleaner_confirmation_status?: 'awaiting' | 'approved' | 'rejected';
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
        scheduled_date,
        scheduled_time,
        status,
        total_price,
        special_requests,
        notes,
        series_id,
        cleaner_confirmation_status,
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
      console.error("Error deleting appointment", appointmentId, error);
      throw error;
    }

    // If no row was returned, RLS blocked the delete (0 rows affected).
    if (!data || data.length === 0) {
      console.error("Delete affected 0 rows (likely RLS). appointmentId:", appointmentId);
      return {
        success: false,
        error:
          "You don't have permission to delete this appointment, or it no longer exists.",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("deleteAppointment failed", appointmentId, error);
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
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
  service_type: {
    name: string;
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
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchCustomers = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
      
      // Get homeowners in the organization via organization_members
      const { data: orgMembers, error: membersError } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', currentOrganizationId)
        .eq('role', 'homeowner');

      if (membersError) throw membersError;

      if (!orgMembers || orgMembers.length === 0) {
        setCustomers([]);
        setLoading(false);
        return;
      }

      const homeownerIds = orgMembers.map(m => m.user_id);

      // Get user profiles for these homeowners
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select(`
          id,
          first_name,
          last_name,
          email,
          phone,
          avatar_url,
          created_at,
          updated_at
        `)
        .in('id', homeownerIds)
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get properties count for each homeowner
      const { data: propertiesData, error: propertiesError } = await supabase
        .from('properties')
        .select('owner_id')
        .eq('organization_id', currentOrganizationId)
        .in('owner_id', homeownerIds);

      if (propertiesError) throw propertiesError;

      // Get appointments data for each homeowner
      const { data: appointmentsData, error: appointmentsError } = await supabase
        .from('appointments')
        .select('homeowner_id, total_price, scheduled_date')
        .eq('organization_id', currentOrganizationId)
        .in('homeowner_id', homeownerIds);

      if (appointmentsError) throw appointmentsError;

      // Calculate counts and totals for each customer
      const propertiesCount: Record<string, number> = {};
      const appointmentsCount: Record<string, number> = {};
      const totalSpent: Record<string, number> = {};
      const lastAppointment: Record<string, string | null> = {};

      propertiesData?.forEach(p => {
        propertiesCount[p.owner_id] = (propertiesCount[p.owner_id] || 0) + 1;
      });

      appointmentsData?.forEach(a => {
        appointmentsCount[a.homeowner_id] = (appointmentsCount[a.homeowner_id] || 0) + 1;
        totalSpent[a.homeowner_id] = (totalSpent[a.homeowner_id] || 0) + Number(a.total_price);
        
        const currentDate = lastAppointment[a.homeowner_id];
        if (!currentDate || a.scheduled_date > currentDate) {
          lastAppointment[a.homeowner_id] = a.scheduled_date;
        }
      });

      // Combine all data
      const customersData: AdminCustomer[] = (profiles || []).map(profile => ({
        ...profile,
        properties_count: propertiesCount[profile.id] || 0,
        appointments_count: appointmentsCount[profile.id] || 0,
        total_spent: totalSpent[profile.id] || 0,
        last_appointment_date: lastAppointment[profile.id] || null,
      }));

      setCustomers(customersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch customers');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Update a single customer in state without refetching
  const updateCustomerInState = useCallback((customerId: string, updatedData: Partial<AdminCustomer>) => {
    setCustomers(prevCustomers => 
      prevCustomers.map(customer => 
        customer.id === customerId 
          ? { ...customer, ...updatedData }
          : customer
      )
    );
  }, []);

  return { customers, loading, error, refetch: fetchCustomers, updateCustomerInState };
}

export function useCustomerDetails(customerId: string | null) {
  const [appointments, setAppointments] = useState<CustomerAppointment[]>([]);
  const [properties, setProperties] = useState<CustomerProperty[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currentOrganizationId } = useAuth();

  const fetchDetails = useCallback(async () => {
    if (!customerId || !currentOrganizationId) return;

    try {
      setLoading(true);

      // Fetch customer's appointments
      const { data: appointmentsData, error: appointmentsError } = await supabase
        .from('appointments')
        .select(`
          id,
          scheduled_date,
          scheduled_time,
          status,
          total_price,
          service_type:service_types(name),
          property:properties(name, address)
        `)
        .eq('organization_id', currentOrganizationId)
        .eq('homeowner_id', customerId)
        .order('scheduled_date', { ascending: false });

      if (appointmentsError) throw appointmentsError;

      // Transform appointments data
      const transformedAppointments = (appointmentsData || []).map(apt => ({
        ...apt,
        service_type: Array.isArray(apt.service_type) ? apt.service_type[0] : apt.service_type,
        property: Array.isArray(apt.property) ? apt.property[0] : apt.property,
      }));

      setAppointments(transformedAppointments);

      // Fetch customer's properties
      const { data: propertiesData, error: propertiesError } = await supabase
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
        .eq('organization_id', currentOrganizationId)
        .eq('owner_id', customerId)
        .order('created_at', { ascending: false });

      if (propertiesError) throw propertiesError;

      setProperties(propertiesData || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch customer details');
    } finally {
      setLoading(false);
    }
  }, [customerId, currentOrganizationId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  return { appointments, properties, loading, error, refetch: fetchDetails };
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

// Helper function to delete a customer (removes from organization)
export async function deleteCustomer(customerId: string, organizationId: string) {
  try {
    // Remove from organization_members (soft delete - keeps their user profile)
    const { error } = await supabase
      .from('organization_members')
      .delete()
      .eq('user_id', customerId)
      .eq('organization_id', organizationId)
      .eq('role', 'homeowner');

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete customer' };
  }
}

// Helper function to delete multiple customers
export async function deleteCustomers(customerIds: string[], organizationId: string) {
  try {
    const { error } = await supabase
      .from('organization_members')
      .delete()
      .in('user_id', customerIds)
      .eq('organization_id', organizationId)
      .eq('role', 'homeowner');

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete customers' };
  }
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
  const [properties, setProperties] = useState<AdminProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchProperties = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
      
      // First, get all homeowners in this organization
      const { data: orgMembers, error: membersError } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', currentOrganizationId)
        .eq('role', 'homeowner');

      if (membersError) throw membersError;

      if (!orgMembers || orgMembers.length === 0) {
        setProperties([]);
        setLoading(false);
        return;
      }

      const homeownerIds = orgMembers.map(m => m.user_id);

      // Then, get properties owned by these homeowners
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
        .in('owner_id', homeownerIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedData = (data || []).map(property => ({
        ...property,
        homeowner: Array.isArray(property.homeowner) ? property.homeowner[0] : property.homeowner
      }));
      
      setProperties(transformedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch properties');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const refetch = useCallback(() => {
    fetchProperties();
  }, [fetchProperties]);

  // Update a single property in state without refetching
  const updatePropertyInState = useCallback((propertyId: string, updatedData: Partial<AdminProperty>) => {
    setProperties(prevProperties => 
      prevProperties.map(property => 
        property.id === propertyId 
          ? { ...property, ...updatedData }
          : property
      )
    );
  }, []);

  return { properties, loading, error, refetch, updatePropertyInState };
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
    // First verify the property belongs to a homeowner in this organization
    const { data: orgMembers } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'homeowner');

    if (!orgMembers || orgMembers.length === 0) {
      return { success: false, error: 'No homeowners found in organization' };
    }

    const homeownerIds = orgMembers.map(m => m.user_id);

    // Check if property belongs to a homeowner in this organization
    const { data: property, error: checkError } = await supabase
      .from('properties')
      .select('owner_id')
      .eq('id', propertyId)
      .single();

    if (checkError) throw checkError;

    if (!property || !homeownerIds.includes(property.owner_id)) {
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

// Helper function to delete multiple properties
export async function deleteProperties(propertyIds: string[], organizationId: string) {
  try {
    // First verify the properties belong to homeowners in this organization
    const { data: orgMembers } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'homeowner');

    if (!orgMembers || orgMembers.length === 0) {
      return { success: false, error: 'No homeowners found in organization' };
    }

    const homeownerIds = orgMembers.map(m => m.user_id);

    // Check if properties belong to homeowners in this organization
    const { data: properties, error: checkError } = await supabase
      .from('properties')
      .select('id, owner_id')
      .in('id', propertyIds);

    if (checkError) throw checkError;

    if (!properties) {
      return { success: false, error: 'Properties not found' };
    }

    // Filter to only delete properties that belong to this organization
    const validPropertyIds = properties
      .filter(p => homeownerIds.includes(p.owner_id))
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
  role: 'cleaner' | 'manager';
  // Cleaner-specific fields
  cleaner_profile?: {
    rating: number;
    total_jobs: number;
    is_available: boolean;
  } | null;
  // Manager-specific fields
  permissions?: ManagerPermissions | null;
}

export interface ManagerPermissions {
  can_view_customers: boolean;
  can_edit_customers: boolean;
  can_view_bookings: boolean;
  can_edit_bookings: boolean;
  can_approve_decline_bookings: boolean;
  can_manage_cleaners: boolean;
  can_view_properties: boolean;
  can_edit_properties: boolean;
  can_view_analytics: boolean;
  can_view_payments: boolean;
  can_manage_payments: boolean;
  can_view_messages: boolean;
  can_view_services: boolean;
  can_manage_services: boolean;
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
        .in('role', ['cleaner', 'manager']);

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
      const { data: managerPermissions, error: permissionsError } = await supabase
        .from('manager_permissions')
        .select('manager_id, can_view_customers, can_edit_customers, can_view_bookings, can_edit_bookings, can_approve_decline_bookings, can_manage_cleaners, can_view_properties, can_edit_properties, can_view_analytics, can_view_payments, can_manage_payments, can_view_messages, can_view_services, can_manage_services')
        .in('manager_id', managerIds)
        .eq('organization_id', currentOrganizationId);

      if (permissionsError) throw permissionsError;

      // Combine all data
      const teamMembersData: TeamMember[] = orgMembers.map(member => {
        const profile = profiles?.find(p => p.id === member.user_id);
        const cleanerProfile = member.role === 'cleaner' 
          ? cleanerProfiles?.find(cp => cp.id === member.user_id)
          : null;
        const permissions = member.role === 'manager'
          ? managerPermissions?.find(mp => mp.manager_id === member.user_id)
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
          permissions: permissions ? {
            can_view_customers: permissions.can_view_customers || false,
            can_edit_customers: permissions.can_edit_customers || false,
            can_view_bookings: permissions.can_view_bookings || false,
            can_edit_bookings: permissions.can_edit_bookings || false,
            can_approve_decline_bookings: permissions.can_approve_decline_bookings || false,
            can_manage_cleaners: permissions.can_manage_cleaners || false,
            can_view_properties: permissions.can_view_properties || false,
            can_edit_properties: permissions.can_edit_properties || false,
            can_view_analytics: permissions.can_view_analytics || false,
            can_view_payments: permissions.can_view_payments || false,
            can_manage_payments: permissions.can_manage_payments || false,
            can_view_messages: permissions.can_view_messages || false,
            can_view_services: permissions.can_view_services || false,
            can_manage_services: permissions.can_manage_services || false,
          } : null,
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
    const response = await fetch('/api/admin/update-manager-permissions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

// Helper function to create a team member
export async function createTeamMember(data: {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: 'cleaner' | 'manager';
  organizationId: string;
}) {
  try {
    const response = await fetch('/api/admin/create-team-member', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Failed to create team member',
      };
    }

    return { success: true, data: result.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create team member',
    };
  }
}
