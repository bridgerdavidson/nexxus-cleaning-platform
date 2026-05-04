'use client';

import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useOrgQuery } from '../lib/useOrgQuery';
import { keys } from '../lib/queryKeys';

export interface BookingTrendData {
  date: string;
  bookings: number;
  revenue: number;
}

export interface AnalyticsMetrics {
  avgCleaningDuration: number;
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

const EMPTY_METRICS: AnalyticsMetrics = {
  avgCleaningDuration: 0,
  avgCleanerRating: 0,
  revenuePerCleaner: 0,
  revenuePerProperty: 0,
  totalBookings: 0,
  totalRevenue: 0,
  totalCleaners: 0,
  totalProperties: 0,
};

export function useAnalyticsData(options: UseAnalyticsDataOptions = {}) {
  const { currentOrganizationId } = useAuth();
  const orgId = currentOrganizationId ?? '';

  const endDate = options.endDate || new Date();
  const startDate = options.startDate || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  })();

  const startKey = startDate.toISOString().split('T')[0];
  const endKey = endDate.toISOString().split('T')[0];
  const rangeKey = `${startKey}_${endKey}_p:${options.propertyId ?? 'all'}_c:${options.cleanerId ?? 'all'}`;

  const query = useOrgQuery({
    queryKey: keys.analytics.byOrg(orgId, rangeKey),
    queryFn: async ({ orgId }) => {
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
        .eq('organization_id', orgId)
        .gte('scheduled_date', startKey)
        .lte('scheduled_date', endKey);

      if (options.propertyId) {
        appointmentsQuery = appointmentsQuery.eq('property_id', options.propertyId);
      }
      if (options.cleanerId) {
        appointmentsQuery = appointmentsQuery.eq('cleaner_id', options.cleanerId);
      }

      const { data: appointments, error } = await appointmentsQuery;
      if (error) throw error;

      if (!appointments || appointments.length === 0) {
        return { bookingTrends: [], metrics: EMPTY_METRICS };
      }

      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const groupBy = daysDiff <= 30 ? 'day' : daysDiff <= 90 ? 'week' : 'month';

      const trendsMap = new Map<string, { bookings: number; revenue: number }>();
      appointments.forEach((appointment) => {
        const date = new Date(appointment.scheduled_date);
        let key: string;
        if (groupBy === 'day') {
          key = date.toISOString().split('T')[0];
        } else if (groupBy === 'week') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay() + 1);
          key = `Week of ${weekStart.toISOString().split('T')[0]}`;
        } else {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        const existing = trendsMap.get(key) || { bookings: 0, revenue: 0 };
        trendsMap.set(key, {
          bookings: existing.bookings + 1,
          revenue: existing.revenue + Number(appointment.total_price),
        });
      });

      const bookingTrends: BookingTrendData[] = Array.from(trendsMap.entries())
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalBookings = appointments.length;
      const totalRevenue = appointments.reduce((sum, apt) => sum + Number(apt.total_price), 0);

      const durations = appointments
        .map(apt => apt.duration_minutes)
        .filter((d): d is number => d !== null && d !== undefined);
      const avgCleaningDuration =
        durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;

      const ratings: number[] = [];
      appointments.forEach(apt => {
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
        ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;

      const uniqueCleaners = new Set(
        appointments
          .map(apt => apt.cleaner_id)
          .filter((id): id is string => id !== null && id !== undefined)
      );
      const uniqueProperties = new Set(appointments.map(apt => apt.property_id));

      const totalCleaners = uniqueCleaners.size;
      const totalProperties = uniqueProperties.size;
      const revenuePerCleaner = totalCleaners > 0 ? totalRevenue / totalCleaners : 0;
      const revenuePerProperty = totalProperties > 0 ? totalRevenue / totalProperties : 0;

      return {
        bookingTrends,
        metrics: {
          avgCleaningDuration: Math.round(avgCleaningDuration),
          avgCleanerRating: Math.round(avgCleanerRating * 10) / 10,
          revenuePerCleaner: Math.round(revenuePerCleaner * 100) / 100,
          revenuePerProperty: Math.round(revenuePerProperty * 100) / 100,
          totalBookings,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalCleaners,
          totalProperties,
        },
      };
    },
  });

  return {
    bookingTrends: query.data?.bookingTrends ?? [],
    metrics: query.data?.metrics ?? EMPTY_METRICS,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
