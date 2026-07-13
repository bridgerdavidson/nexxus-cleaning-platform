'use client';

import { useSearchParams } from 'next/navigation';
import { useDetailParam } from '@/hooks/useDetailParam';
import { OperatorBookingSheet } from './OperatorBookingSheet';
import type { NewBookingSeed } from './useOpenOperatorBooking';

/**
 * Renders the operator new-booking sheet when `?newbooking=1` is present. Mounted inside
 * OperatorShell (under Suspense, since it reads search params) so it opens from any operator
 * page. Closing clears the param. `date`/`time` search params (if present) seed the sheet's
 * first slot (e.g. a calendar empty-slot click); `customerId`/`propertyId`/`billTo` (if present)
 * seed the customer, property, and bill-to (e.g. a property's "Book" action).
 */
export function OperatorBookingHost() {
  const { paramId, setParam } = useDetailParam('newbooking');
  const sp = useSearchParams();
  const open = !!paramId;
  const rawBillTo = sp.get('billTo');
  const billTo = rawBillTo === 'customer' || rawBillTo === 'self_pay' ? rawBillTo : undefined;
  const prefill: NewBookingSeed | undefined = open
    ? {
        date: sp.get('date') ?? undefined,
        time: sp.get('time') ?? undefined,
        customerId: sp.get('customerId') ?? undefined,
        propertyId: sp.get('propertyId') ?? undefined,
        billTo,
      }
    : undefined;
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
