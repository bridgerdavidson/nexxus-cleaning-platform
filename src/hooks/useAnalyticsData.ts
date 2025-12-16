'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface BookingTrendData {
  date: string;
  bookings: number;
  revenue: number;
}

export interface AnalyticsMetrics {
  avgCleaningDuration: number; // in minutes
  avgCleanerRating: number;
  revenuePerCleaner: number;
  revenuePerProperty: number;
  totalBookings: number;
  totalRevenue: number;
  totalCleaners: number;
  totalProperties: number;
}

export interface UseAnalyticsDataOptions {
  startDate?: Date;
  endDate?: Date;
  propertyId?: string | null;
  cleanerId?: string | null;
}

export function useAnalyticsData(options: UseAnalyticsDataOptions = {}) {
  const [bookingTrends, setBookingTrends] = useState<BookingTrendData[]>([]);
  const [metrics, setMetrics] = useState<AnalyticsMetrics>({
    avgCleaningDuration: 0,
    avgCleanerRating: 0,
    revenuePerCleaner: 0,
    revenuePerProperty: 0,
    totalBookings: 0,
    totalRevenue: 0,
    totalCleaners: 0,
    totalProperties: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, currentOrganizationId } = useAuth();

  const fetchAnalyticsData = useCallback(async () => {
    if (!user?.id || !currentOrganizationId) return;

    try {
      setLoading(true);
      setError(null);

      // Set default date range to last 30 days if not provided
      const endDate = options.endDate || new Date();
      const startDate = options.startDate || (() => {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        return date;
      })();

      // Build query for appointments
      let appointmentsQuery = supabase
        .from('appointments')
        .select(`
          id,
          scheduled_date,
          total_price,
          duration_minutes,
          cleaner_id,
          property_id,
          status,
          cleaner_profile:cleaner_profiles(
            rating
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .gte('scheduled_date', startDate.toISOString().split('T')[0])
        .lte('scheduled_date', endDate.toISOString().split('T')[0]);

      // Apply filters
      if (options.propertyId) {
        appointmentsQuery = appointmentsQuery.eq('property_id', options.propertyId);
      }
      if (options.cleanerId) {
        appointmentsQuery = appointmentsQuery.eq('cleaner_id', options.cleanerId);
      }

      const { data: appointments, error: appointmentsError } = await appointmentsQuery;

      if (appointmentsError) throw appointmentsError;

      if (!appointments || appointments.length === 0) {
        setBookingTrends([]);
        setMetrics({
          avgCleaningDuration: 0,
          avgCleanerRating: 0,
          revenuePerCleaner: 0,
          revenuePerProperty: 0,
          totalBookings: 0,
          totalRevenue: 0,
          totalCleaners: 0,
          totalProperties: 0,
        });
        return;
      }

      // Calculate date range in days to determine grouping
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const groupBy = daysDiff <= 30 ? 'day' : daysDiff <= 90 ? 'week' : 'month';

      // Group appointments by date period
      const trendsMap = new Map<string, { bookings: number; revenue: number }>();

      appointments.forEach((appointment) => {
        const date = new Date(appointment.scheduled_date);
        let key: string;

        if (groupBy === 'day') {
          key = date.toISOString().split('T')[0];
        } else if (groupBy === 'week') {
          // Get start of week (Monday)
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay() + 1);
          key = `Week of ${weekStart.toISOString().split('T')[0]}`;
        } else {
          // Month
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }

        const existing = trendsMap.get(key) || { bookings: 0, revenue: 0 };
        trendsMap.set(key, {
          bookings: existing.bookings + 1,
          revenue: existing.revenue + Number(appointment.total_price),
        });
      });

      // Convert map to array and sort by date
      const trends: BookingTrendData[] = Array.from(trendsMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setBookingTrends(trends);

      // Calculate metrics
      const totalBookings = appointments.length;
      const totalRevenue = appointments.reduce(
        (sum, apt) => sum + Number(apt.total_price),
        0
      );

      // Average cleaning duration
      const durations = appointments
        .map((apt) => apt.duration_minutes)
        .filter((d): d is number => d !== null && d !== undefined);
      const avgCleaningDuration =
        durations.length > 0
          ? durations.reduce((sum, d) => sum + d, 0) / durations.length
          : 0;

      // Average cleaner rating
      const ratings: number[] = [];
      appointments.forEach((apt) => {
        if (apt.cleaner_profile) {
          const profile = Array.isArray(apt.cleaner_profile)
            ? apt.cleaner_profile[0]
            : apt.cleaner_profile;
          if (profile?.rating && typeof profile.rating === 'number') {
            ratings.push(profile.rating);
          }
        }
      });
      const avgCleanerRating =
        ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;

      // Get unique cleaners and properties
      const uniqueCleaners = new Set(
        appointments
          .map((apt) => apt.cleaner_id)
          .filter((id): id is string => id !== null && id !== undefined)
      );
      const uniqueProperties = new Set(appointments.map((apt) => apt.property_id));

      const totalCleaners = uniqueCleaners.size;
      const totalProperties = uniqueProperties.size;

      // Revenue per cleaner/property
      const revenuePerCleaner = totalCleaners > 0 ? totalRevenue / totalCleaners : 0;
      const revenuePerProperty = totalProperties > 0 ? totalRevenue / totalProperties : 0;

      setMetrics({
        avgCleaningDuration: Math.round(avgCleaningDuration),
        avgCleanerRating: Math.round(avgCleanerRating * 10) / 10,
        revenuePerCleaner: Math.round(revenuePerCleaner * 100) / 100,
        revenuePerProperty: Math.round(revenuePerProperty * 100) / 100,
        totalBookings,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCleaners,
        totalProperties,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics data');
    } finally {
      setLoading(false);
    }
  }, [user?.id, currentOrganizationId, options.startDate, options.endDate, options.propertyId, options.cleanerId]);

  useEffect(() => {
    fetchAnalyticsData();
  }, [fetchAnalyticsData]);

  return {
    bookingTrends,
    metrics,
    loading,
    error,
    refetch: fetchAnalyticsData,
  };
}

