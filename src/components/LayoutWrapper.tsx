'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import Navbar from './Navbar';
//import { useTabVisibility } from '../hooks/useTabVisibility';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  // #region agent log
  const instanceId = useRef(Math.random().toString(36).substring(7));
  useEffect(() => {
    fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LayoutWrapper.tsx:8',message:'LayoutWrapper mounted',data:{instanceId:instanceId.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    return () => {
      fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LayoutWrapper.tsx:8',message:'LayoutWrapper unmounted',data:{instanceId:instanceId.current},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    };
  }, []);
  // #endregion
  
  const pathname = usePathname();
  
  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LayoutWrapper.tsx:20',message:'LayoutWrapper render',data:{instanceId:instanceId.current,pathname},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
  });
  // #endregion
  
  // Handle tab visibility changes to maintain Supabase connection
  //useTabVisibility();

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
    <>
      {/* Dashboard pages render their own header with tabs */}
      {!isDashboard && <Navbar />}
      <div className={!isDashboard ? 'pt-16' : ''}>
        {children}
      </div>
    </>
  );
}

