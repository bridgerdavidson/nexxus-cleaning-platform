'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface AdminAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  total_price: number;
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

export interface AdminCleaner {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    email: string;
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

  return { appointments, loading, error, refetch };
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
            email
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

  return { cleaners, loading, error, refetch: fetchCleaners };
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
    return { success: true };
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
        status: 'confirmed'
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

  return { customers, loading, error, refetch: fetchCustomers };
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
) {
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .eq('id', customerId);

    if (error) throw error;
    return { success: true };
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

  return { properties, loading, error, refetch };
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
    special_instructions?: string | null;
    access_instructions?: string | null;
  }
) {
  try {
    const { error } = await supabase
      .from('properties')
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .eq('id', propertyId);

    if (error) throw error;
    return { success: true };
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