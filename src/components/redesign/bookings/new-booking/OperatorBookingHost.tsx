'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDetailParam } from '@/hooks/useDetailParam';
import { useBilling } from '@/hooks/useBilling';
import { usePaywall } from '@/components/redesign/billing/usePaywall';
import { bookingHostGate } from './operatorBookingHostModel';
import { OperatorBookingSheet } from './OperatorBookingSheet';
import type { NewBookingSeed } from './useOpenOperatorBooking';

/**
 * Renders the operator new-booking sheet when `?newbooking=1` is present. Mounted inside
 * OperatorShell (under Suspense, since it reads search params) so it opens from any operator
 * page. Closing clears the param. `date`/`time` search params (if present) seed the sheet's
 * first slot (e.g. a calendar empty-slot click); `customerId`/`propertyId`/`billTo` (if present)
 * seed the customer, property, and bill-to (e.g. a property's "Book" action).
 *
 * Task 12: also the ONE place that intercepts every one of the several
 * `?newbooking=1` triggers across the shell (top bar, mobile FAB, command
 * palette, calendar, bookings page, customer/property "Book" actions,
 * messages) when the org is frozen. Gating here instead of at each button
 * means no trigger can be missed. The decision itself lives in the pure
 * bookingHostGate (operatorBookingHostModel.ts); this file only wires it.
 */
export function OperatorBookingHost() {
  const { paramId, setParam } = useDetailParam('newbooking');
  const sp = useSearchParams();
  const { uiEnabled: billingUiEnabled, access, isOwner } = useBilling();
  const { open: openPaywall } = usePaywall();

  const gate = bookingHostGate({
    paramPresent: !!paramId,
    uiEnabled: billingUiEnabled,
    frozen: !!access?.frozen,
    isOwner,
  });

  // Side effects (opening the wall, clearing the URL) belong in an effect,
  // not render. gate.clearParam is only true once per param transition (it
  // goes false again the instant setParam(null) removes ?newbooking=1), so
  // this cannot loop.
  useEffect(() => {
    if (!gate.clearParam) return;
    if (gate.openWall) openPaywall();
    setParam(null);
  }, [gate.clearParam, gate.openWall, openPaywall, setParam]);

  const rawBillTo = sp.get('billTo');
  const billTo = rawBillTo === 'customer' || rawBillTo === 'self_pay' ? rawBillTo : undefined;
  const prefill: NewBookingSeed | undefined = gate.showSheet
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
      open={gate.showSheet}
      prefill={prefill}
      onOpenChange={(v) => {
        if (!v) setParam(null);
      }}
    />
  );
}
