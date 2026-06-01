'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { authDebug, tokenTail } from '../lib/authDebug';

export default function AuthQueryBridge() {
  const { accessToken } = useAuth();
  const lastTokenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (lastTokenRef.current !== undefined && lastTokenRef.current !== accessToken) {
      authDebug('token-change', {
        from: tokenTail(lastTokenRef.current),
        to: tokenTail(accessToken),
      });
      // Hand the rotated JWT to the realtime websocket. Without this the
      // socket keeps the old token forever and Postgres RLS silently rejects
      // events after the ~1h expiry — the "laptop slept, had to reload"
      // class of bug.
      supabase.realtime.setAuth(accessToken ?? '');
      // NOTE: we intentionally do NOT invalidateQueries() here. Read queries go
      // through the shared supabase client, which already attaches its own
      // auto-refreshed session token to every request, so cached data stays
      // valid across a rotation. A blanket invalidate refetched all ~10-20
      // dashboard queries at once on every ~1h rotation — a refetch storm that
      // was very visible in production (higher RTT + per-query RLS). Natural
      // refetch triggers (mount, reconnect, AuthContext visibility revalidation)
      // keep data fresh; if a specific query ever needs to refetch on rotation,
      // invalidate that key explicitly rather than the whole cache.
    }
    lastTokenRef.current = accessToken;
  }, [accessToken]);

  return null;
}
