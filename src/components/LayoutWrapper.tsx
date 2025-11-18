'use client';

import { usePathname } from 'next/navigation';
import Navbar from './Navbar';
import DashboardHeader from './DashboardHeader';
//import { useTabVisibility } from '../hooks/useTabVisibility';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Handle tab visibility changes to maintain Supabase connection
  //useTabVisibility();

  // Determine if we're on a dashboard page and which role
  const isDashboard = pathname?.includes('-dashboard');
  
  let dashboardRole: 'homeowner' | 'cleaner' | 'manager' | 'admin' | null = null;
  
  if (pathname?.includes('homeowner-dashboard')) {
    dashboardRole = 'homeowner';
  } else if (pathname?.includes('cleaner-dashboard')) {
    dashboardRole = 'cleaner';
  } else if (pathname?.includes('manager-dashboard')) {
    dashboardRole = 'manager';
  } else if (pathname?.includes('admin-dashboard')) {
    dashboardRole = 'admin';
  }

  return (
    <>
      {isDashboard && dashboardRole ? (
        <DashboardHeader role={dashboardRole} />
      ) : (
        <Navbar />
      )}
      {children}
    </>
  );
}

