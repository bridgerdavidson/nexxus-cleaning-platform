'use client';

import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AuthProvider } from '../contexts/AuthContext';
import { BrandProvider } from './branding/BrandProvider';
import { BrandDocumentIdentity } from './branding/BrandDocumentIdentity';
import { ToastProvider } from '../contexts/ToastContext';
import AuthQueryBridge from './AuthQueryBridge';
import AuthDebugOverlay from './AuthDebugOverlay';
import { ImpersonationBanner } from './platform/ImpersonationBanner';
import { makeQueryClient } from '../lib/queryClient';
//import { useTabVisibility } from '../hooks/useTabVisibility';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());

  // Suppress browser extension errors (React DevTools, Redux DevTools, etc.)
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // Suppress errors from browser extensions
      if (
        event.message?.includes('disconnected port') ||
        event.message?.includes('Extension context invalidated') ||
        event.filename?.includes('proxy.js') ||
        event.filename?.includes('chrome-extension://') ||
        event.filename?.includes('moz-extension://')
      ) {
        event.preventDefault();
        return false;
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Suppress promise rejections from browser extensions
      const reason = event.reason?.toString() || '';
      if (
        reason.includes('disconnected port') ||
        reason.includes('Extension context invalidated') ||
        reason.includes('proxy.js')
      ) {
        event.preventDefault();
        return false;
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // The legacy marketing Navbar is gone. Every page is now either full-screen
  // (auth flows) or owns its own chrome (dashboards, platform owner), so we
  // render children directly with no shared top bar.
  return (
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrandProvider>
            <BrandDocumentIdentity />
            <AuthQueryBridge />
            <AuthDebugOverlay />
            <ImpersonationBanner />
            {children}
          </BrandProvider>
        </AuthProvider>
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
        )}
      </QueryClientProvider>
    </ToastProvider>
  );
}

