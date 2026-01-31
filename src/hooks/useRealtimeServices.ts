'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { ServiceType } from './useServices';

export interface UseRealtimeServicesOptions {
  organizationId: string;
  onInsert: (service: ServiceType) => void;
  onUpdate: (service: ServiceType) => void;
  onDelete: (serviceId: string) => void;
  enabled?: boolean;
}

/**
 * Hook to subscribe to realtime service_types changes
 * 
 * Supabase Realtime sends the full row data in payload.new (INSERT/UPDATE)
 * and payload.old (DELETE). We pass the full data to callbacks so they
 * can update state directly without extra fetches.
 */
export function useRealtimeServices({
  organizationId,
  onInsert,
  onUpdate,
  onDelete,
  enabled = true,
}: UseRealtimeServicesOptions) {
  const callbacksRef = useRef({ onInsert, onUpdate, onDelete });
  const organizationIdRef = useRef(organizationId);

  // Keep callbacks and organizationId in refs to avoid re-subscribing on every render
  useEffect(() => {
    callbacksRef.current = { onInsert, onUpdate, onDelete };
    organizationIdRef.current = organizationId;
  }, [onInsert, onUpdate, onDelete, organizationId]);

  useEffect(() => {
    if (!enabled || !organizationId) {
      return;
    }

    // Create a unique channel name for this subscription
    const channelName = `services:${organizationId}`;
    
    const channel = supabase
      .channel(channelName)
      .on<ServiceType>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'service_types',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload: RealtimePostgresChangesPayload<ServiceType>) => {
          const service = payload.new as ServiceType | null;
          if (service?.id) {
            callbacksRef.current.onInsert(service);
          }
        }
      )
      .on<ServiceType>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'service_types',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload: RealtimePostgresChangesPayload<ServiceType>) => {
          const service = payload.new as ServiceType | null;
          if (service?.id) {
            callbacksRef.current.onUpdate(service);
          }
        }
      )
      .on<ServiceType>(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'service_types',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload: RealtimePostgresChangesPayload<ServiceType>) => {
          const service = payload.old as ServiceType | null;
          if (service?.id) {
            callbacksRef.current.onDelete(service.id);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Subscribed to services for org ${organizationIdRef.current}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Error subscribing to services');
        }
      });

    // Cleanup subscription on unmount or when organizationId changes
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, organizationId]);
}
