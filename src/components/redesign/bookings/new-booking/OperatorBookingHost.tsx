'use client';

import { useDetailParam } from '@/hooks/useDetailParam';
import { OperatorBookingSheet } from './OperatorBookingSheet';

/**
 * Renders the operator new-booking sheet when `?newbooking=1` is present. Mounted inside
 * OperatorShell (under Suspense, since it reads search params) so it opens from any operator
 * page. Closing clears the param.
 */
export function OperatorBookingHost() {
  const { paramId, setParam } = useDetailParam('newbooking');
  return (
    <OperatorBookingSheet
      open={!!paramId}
      onOpenChange={(v) => {
        if (!v) setParam(null);
      }}
    />
  );
}
