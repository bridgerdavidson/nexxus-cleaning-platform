'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import Navbar from './Navbar';
import AuthQueryBridge from './AuthQueryBridge';
import AuthDebugOverlay from './AuthDebugOverlay';
import { ImpersonationBanner } from './platform/ImpersonationBanner';
import { makeQueryClient } from '../lib/queryClient';
//import { useTabVisibility } from '../hooks/useTabVisibility';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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

  // Determine if we're on a dashboard page or a page that manages its own header
  const isDashboard = pathname?.includes('-dashboard');
  const isFullScreen =
    isDashboard ||
    pathname === '/settings' ||
    pathname?.startsWith('/settings/') ||
    pathname?.startsWith('/accept-invite') ||
    pathname?.startsWith('/forgot-password') ||
    pathname?.startsWith('/reset-password');

  return (
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthQueryBridge />
          <AuthDebugOverlay />
          <ImpersonationBanner />
          {!isFullScreen && <Navbar />}
          <div className={!isFullScreen ? 'pt-16' : ''}>
            {children}
          </div>
        </AuthProvider>
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
        )}
      </QueryClientProvider>
    </ToastProvider>
  );
}

