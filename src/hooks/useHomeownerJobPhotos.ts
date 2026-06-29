'use client';

import { supabase } from '@/lib/supabase';
import { useOrgQuery } from '@/lib/useOrgQuery';
import { keys } from '@/lib/queryKeys';
import { useSupabaseRealtimeSync } from '@/lib/useSupabaseRealtimeSync';

// Local interface mirrors useCleanerData.ts's JobPhoto (src/hooks/useCleanerData.ts).
// @/types does not export JobPhoto so we define it here instead of importing it.
interface JobPhoto {
  id: string;
  photo_url: string;
  photo_type: 'before' | 'after' | 'during';
  uploaded_at: string;
}

/**
 * Read-only hook for a homeowner watching their cleaning live.
 * Fetches before/after job photos for the appointment and subscribes to
 * realtime INSERTs on job_photos so new photos appear automatically.
 */
export function useHomeownerJobPhotos(appointmentId: string | null): {
  beforePhotos: JobPhoto[];
  afterPhotos: JobPhoto[];
  isLoading: boolean;
} {
  const queryKey = keys.jobPhotos.byAppointment(appointmentId ?? '');

  const query = useOrgQuery({
    queryKey,
    enabled: !!appointmentId,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('job_photos')
        .select('id, photo_url, photo_type, uploaded_at')
        .eq('appointment_id', appointmentId as string)
        .order('uploaded_at', { ascending: true })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as JobPhoto[];
    },
  });

  useSupabaseRealtimeSync({
    channelName: `job-photos:homeowner:${appointmentId}`,
    table: 'job_photos',
    filter: appointmentId ? `appointment_id=eq.${appointmentId}` : undefined,
    enabled: !!appointmentId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const all = query.data ?? [];
  return {
    beforePhotos: all.filter(p => p.photo_type === 'before'),
    afterPhotos: all.filter(p => p.photo_type === 'after'),
    isLoading: query.isLoading,
  };
}
