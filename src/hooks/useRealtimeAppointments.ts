'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export interface RealtimeAppointmentFilters {
  organizationId: string;
  cleanerId?: string; // For cleaner-specific subscriptions
}

export interface UseRealtimeAppointmentsOptions {
  filters: RealtimeAppointmentFilters;
  onInsert: (appointmentId: string) => void;
  onUpdate: (appointmentId: string) => void;
  onDelete: (appointmentId: string) => void;
  enabled?: boolean;
}

/**
 * Hook to subscribe to realtime appointment changes
 * 
 * Note: Supabase Realtime only sends raw row data, not joined relations.
 * The callbacks (onInsert, onUpdate, onDelete) should fetch the full appointment
 * with relations when needed, or update state optimistically.
 */
export function useRealtimeAppointments({
  filters,
  onInsert,
  onUpdate,
  onDelete,
  enabled = true,
}: UseRealtimeAppointmentsOptions) {
  const callbacksRef = useRef({ onInsert, onUpdate, onDelete });
  const filtersRef = useRef(filters);

  // Keep callbacks and filters in refs to avoid re-subscribing on every render
  useEffect(() => {
    callbacksRef.current = { onInsert, onUpdate, onDelete };
    filtersRef.current = filters;
  }, [onInsert, onUpdate, onDelete, filters]);

  useEffect(() => {
    if (!enabled || !filters.organizationId) {
      return;
    }

    // Create a unique channel name for this subscription
    const channelName = `appointments:${filters.organizationId}${filters.cleanerId ? `:${filters.cleanerId}` : ''}`;
    
    // Supabase Realtime filters only support single column filters
    // We'll filter by organization_id and check cleaner_id in the callback if needed
    const channel = supabase
      .channel(channelName)
      .on<never>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'appointments',
          filter: `organization_id=eq.${filters.organizationId}`,
        },
        (payload: RealtimePostgresChangesPayload<never>) => {
          const appointment = payload.new as { id: string; cleaner_id: string | null; organization_id: string } | null;
          if (appointment?.id) {
            // If cleanerId filter is specified, only process if it matches
            if (filters.cleanerId && appointment.cleaner_id !== filters.cleanerId) {
              return;
            }
            callbacksRef.current.onInsert(appointment.id);
          }
        }
      )
      .on<never>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'appointments',
          filter: `organization_id=eq.${filters.organizationId}`,
        },
        (payload: RealtimePostgresChangesPayload<never>) => {
          const appointment = payload.new as { id: string; cleaner_id: string | null; organization_id: string } | null;
          if (appointment?.id) {
            // If cleanerId filter is specified, only process if it matches
            if (filters.cleanerId && appointment.cleaner_id !== filters.cleanerId) {
              return;
            }
            callbacksRef.current.onUpdate(appointment.id);
          }
        }
      )
      .on<never>(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'appointments',
          filter: `organization_id=eq.${filters.organizationId}`,
        },
        (payload: RealtimePostgresChangesPayload<never>) => {
          const appointment = payload.old as { id: string; cleaner_id: string | null; organization_id: string } | null;
          if (appointment?.id) {
            // If cleanerId filter is specified, only process if it matches
            if (filters.cleanerId && appointment.cleaner_id !== filters.cleanerId) {
              return;
            }
            callbacksRef.current.onDelete(appointment.id);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Subscribed to appointments for org ${filtersRef.current.organizationId}${filtersRef.current.cleanerId ? ` (cleaner: ${filtersRef.current.cleanerId})` : ''}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Error subscribing to appointments');
        }
      });

    // Cleanup subscription on unmount or when filters change
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, filters.organizationId, filters.cleanerId]);
}

