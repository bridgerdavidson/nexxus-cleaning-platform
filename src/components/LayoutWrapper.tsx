'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { AuthProvider } from '../contexts/AuthContext';
import Navbar from './Navbar';
//import { useTabVisibility } from '../hooks/useTabVisibility';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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

  // Determine if we're on a dashboard page
  const isDashboard = pathname?.includes('-dashboard');

  return (
    <AuthProvider>
      {/* Dashboard pages render their own header with tabs */}
      {!isDashboard && <Navbar />}
      <div className={!isDashboard ? 'pt-16' : ''}>
        {children}
      </div>
    </AuthProvider>
  );
}

