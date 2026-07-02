'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useDetailParam } from '@/hooks/useDetailParam';
import { BookingFlow } from './BookingFlow';

/**
 * Mounts the booking flow when `?book=1` is present. Reads the `?bookService=` /
 * `?bookProperty=` prefill. Mounted in the homeowner layout (under Suspense, since it
 * reads search params) alongside the other detail hosts, so it opens from any tab.
 */
export function BookingFlowHost() {
  const { paramId } = useDetailParam('book');
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  if (!paramId) return null;
  return (
    <BookingFlow
      initialServiceTypeId={sp.get('bookService')}
      initialPropertyId={sp.get('bookProperty')}
      onClose={() => router.replace(pathname, { scroll: false })}
    />
  );
}
