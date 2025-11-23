'use client';

import { usePathname } from 'next/navigation';
import Navbar from './Navbar';
//import { useTabVisibility } from '../hooks/useTabVisibility';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Handle tab visibility changes to maintain Supabase connection
  //useTabVisibility();

  // Determine if we're on a dashboard page
  const isDashboard = pathname?.includes('-dashboard');

  return (
    <>
      {/* Dashboard pages render their own header with tabs */}
      {!isDashboard && <Navbar />}
      {children}
    </>
  );
}

