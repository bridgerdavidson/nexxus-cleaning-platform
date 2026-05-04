'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';

export default function AuthQueryBridge() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const lastTokenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (lastTokenRef.current !== undefined && lastTokenRef.current !== accessToken) {
      queryClient.invalidateQueries();
    }
    lastTokenRef.current = accessToken;
  }, [accessToken, queryClient]);

  return null;
}
