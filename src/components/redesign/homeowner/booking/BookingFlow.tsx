'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { toast } from '@/components/ui/toast';
import { homeownerCardPickerAvailable } from '@/components/HomeownerCardPicker';
import { useHomeownerProperties } from '@/hooks/useHomeownerData';
import { useServices } from '@/hooks/useServices';
import { useSavedPaymentMethods } from '../account/payment-methods/useSavedPaymentMethods';
import { EMPTY_BOOKING, type BookingState } from './booking-types';
import { addSlot, removeSlotAt } from './deriveBooking';
import { useSubmitBookingRequest } from './useSubmitBookingRequest';
import { BookingPicksView } from './BookingPicksView';
import { BookingReviewView } from './BookingReviewView';
import { BookingSentView } from './BookingSentView';
import { PropertyPickerSheet } from './PropertyPickerSheet';
import { ServicePickerSheet } from './ServicePickerSheet';
import { TimePickerSheet } from './TimePickerSheet';
import { CardPickerSheet } from './CardPickerSheet';

type Page = 'picks' | 'review' | 'sent';

export function BookingFlow({
  initialServiceTypeId,
  initialPropertyId,
  onClose,
}: {
  initialServiceTypeId: string | null;
  initialPropertyId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<BookingState>({
    ...EMPTY_BOOKING,
    propertyId: initialPropertyId,
    serviceTypeId: initialServiceTypeId,
  });
  const [page, setPage] = useState<Page>('picks');
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  const { properties } = useHomeownerProperties();
  const { services } = useServices();
  const { cards } = useSavedPaymentMethods();

  const paymentRequired = homeownerCardPickerAvailable();
  const property = properties.find((p) => p.id === state.propertyId) ?? null;
  const service = services.find((s) => s.id === state.serviceTypeId) ?? null;
  const card = cards.find((c) => c.id === state.paymentMethodId) ?? null;

  // Pre-select the only home so a single-property homeowner skips the picker.
  useEffect(() => {
    if (!state.propertyId && properties.length === 1) {
      setState((s) => ({ ...s, propertyId: properties[0].id }));
    }
  }, [properties, state.propertyId]);

  const { submit, submitting } = useSubmitBookingRequest();

  async function handleSend() {
    try {
      await submit(state);
      setPage('sent');
    } catch (e) {
      toast.error('Could not send your request', {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  return (
    <MobileTakeover ariaLabel="Request a cleaning" keyboardAware onClosed={onClose}>
      {(close) => (
        <>
          {page === 'sent' ? (
            <BookingSentView onDone={() => router.push('/app/homeowner-dashboard/cleanings')} />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-2">
                <button
                  onClick={page === 'review' ? () => setPage('picks') : close}
                  aria-label="Back"
                  className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft className="size-6" />
                </button>
                <div className="min-w-0 flex-1 py-2">
                  <div className="truncate text-sm font-bold">
                    {page === 'review' ? 'Review & send' : 'Request a cleaning'}
                  </div>
                </div>
                <span className="px-2 text-xs font-bold text-muted-foreground">
                  {page === 'review' ? '2/2' : '1/2'}
                </span>
              </div>

              {page === 'picks' ? (
                <BookingPicksView
                  state={state}
                  property={property}
                  service={service}
                  onOpenProperty={() => setPropertyOpen(true)}
                  onOpenService={() => setServiceOpen(true)}
                  onAddTime={() => setTimeOpen(true)}
                  onRemoveTime={(idx) => setState((s) => ({ ...s, slots: removeSlotAt(s.slots, idx) }))}
                  onNotesChange={(v) => setState((s) => ({ ...s, notes: v }))}
                  onReview={() => setPage('review')}
                />
              ) : (
                <BookingReviewView
                  state={state}
                  property={property}
                  service={service}
                  paymentRequired={paymentRequired}
                  card={card}
                  onOpenCard={() => setCardOpen(true)}
                  onSend={handleSend}
                  submitting={submitting}
                />
              )}
            </>
          )}

          <PropertyPickerSheet
            open={propertyOpen}
            onOpenChange={setPropertyOpen}
            selectedId={state.propertyId}
            onSelect={(id) => setState((s) => ({ ...s, propertyId: id }))}
          />
          <ServicePickerSheet
            open={serviceOpen}
            onOpenChange={setServiceOpen}
            selectedId={state.serviceTypeId}
            onSelect={(id) => setState((s) => ({ ...s, serviceTypeId: id }))}
          />
          <TimePickerSheet
            open={timeOpen}
            onOpenChange={setTimeOpen}
            onAdd={(slot) => setState((s) => ({ ...s, slots: addSlot(s.slots, slot) }))}
          />
          <CardPickerSheet
            open={cardOpen}
            onOpenChange={setCardOpen}
            selectedId={state.paymentMethodId}
            onSelect={(pmId, method) => setState((s) => ({ ...s, paymentMethodId: pmId, method }))}
          />
        </>
      )}
    </MobileTakeover>
  );
}
