/**
 * Calls the reassign-cleaner endpoint for the dispatch board's cross-cleaner drag. Returns a
 * structured result so the caller can distinguish a scheduling conflict (offer "assign anyway")
 * from a hard failure.
 */
'use client';
import { useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';

export interface ReassignResult {
  ok: boolean;
  status: number;
  conflict: boolean;
  error?: string;
}

export function useCalendarReassign() {
  const { accessToken, currentOrganizationId } = useAuth();

  return useCallback(
    async (appointmentId: string, cleanerId: string, force: boolean): Promise<ReassignResult> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await fetch('/api/appointments/reassign-cleaner', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          appointmentId,
          cleanerId,
          organizationId: currentOrganizationId,
          force,
        }),
      });

      let data: { success?: boolean; conflict?: boolean; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // non-JSON body (e.g. a 504 timeout) — fall through to status-based result.
      }

      return {
        ok: res.ok && !!data.success,
        status: res.status,
        conflict: res.status === 409 || !!data.conflict,
        error: data.error,
      };
    },
    [accessToken, currentOrganizationId],
  );
}
