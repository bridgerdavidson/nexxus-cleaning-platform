'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export interface PaymentUpdateData {
  appointmentId: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
}

export interface UseRealtimePaymentsOptions {
  onPaymentUpdate: (data: PaymentUpdateData) => void;
  enabled?: boolean;
}

/**
 * Hook to subscribe to realtime payment changes
 * 
 * When a payment status changes (e.g., from Stripe webhook),
 * this hook will notify subscribers so they can update the UI immediately.
 * 
 * Note: The payments table doesn't have an organization_id column,
 * so we subscribe to all payment updates. The callback handler in the
 * consuming hook will naturally ignore updates for appointments not in state.
 * RLS policies will also restrict what payment data the user can see.
 */
export function useRealtimePayments({
  onPaymentUpdate,
  enabled = true,
}: UseRealtimePaymentsOptions) {
  const callbackRef = useRef(onPaymentUpdate);

  // Keep callback in ref to avoid re-subscribing on every render
  useEffect(() => {
    callbackRef.current = onPaymentUpdate;
  }, [onPaymentUpdate]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Create a unique channel name for this subscription
    const channelName = 'payments-updates';
    
    const channel = supabase
      .channel(channelName)
      .on<never>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'payments',
        },
        (payload: RealtimePostgresChangesPayload<never>) => {
          const payment = payload.new as { 
            id: string; 
            appointment_id: string; 
            status: 'pending' | 'paid' | 'failed' | 'refunded';
          } | null;
          
          if (payment?.appointment_id && payment?.status) {
            callbackRef.current({
              appointmentId: payment.appointment_id,
              status: payment.status,
            });
          }
        }
      )
      .on<never>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'payments',
        },
        (payload: RealtimePostgresChangesPayload<never>) => {
          const payment = payload.new as { 
            id: string; 
            appointment_id: string; 
            status: 'pending' | 'paid' | 'failed' | 'refunded';
          } | null;
          
          if (payment?.appointment_id && payment?.status) {
            callbackRef.current({
              appointmentId: payment.appointment_id,
              status: payment.status,
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Subscribed to payments updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Error subscribing to payments');
        }
      });

    // Cleanup subscription on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
