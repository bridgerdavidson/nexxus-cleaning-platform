'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

export default function AuthQueryBridge() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const lastTokenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (lastTokenRef.current !== undefined && lastTokenRef.current !== accessToken) {
      // Hand the rotated JWT to the realtime websocket. Without this the
      // socket keeps the old token forever and Postgres RLS silently rejects
      // events after the ~1h expiry — the "laptop slept, had to reload"
      // class of bug.
      supabase.realtime.setAuth(accessToken ?? '');
      queryClient.invalidateQueries();
    }
    lastTokenRef.current = accessToken;
  }, [accessToken, queryClient]);

  return null;
}
