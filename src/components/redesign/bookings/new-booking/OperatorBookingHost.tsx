'use client';

import { useSearchParams } from 'next/navigation';
import { useDetailParam } from '@/hooks/useDetailParam';
import { OperatorBookingSheet } from './OperatorBookingSheet';

/**
 * Renders the operator new-booking sheet when `?newbooking=1` is present. Mounted inside
 * OperatorShell (under Suspense, since it reads search params) so it opens from any operator
 * page. Closing clears the param. `date`/`time` search params (if present) seed the sheet's
 * first slot, so a calendar empty-slot click can open the sheet pre-filled.
 */
export function OperatorBookingHost() {
  const { paramId, setParam } = useDetailParam('newbooking');
  const sp = useSearchParams();
  const open = !!paramId;
  const prefill = open ? { date: sp.get('date') ?? undefined, time: sp.get('time') ?? undefined } : undefined;
  return (
    <OperatorBookingSheet
      open={open}
      prefill={prefill}
      onOpenChange={(v) => {
        if (!v) setParam(null);
      }}
    />
  );
}
