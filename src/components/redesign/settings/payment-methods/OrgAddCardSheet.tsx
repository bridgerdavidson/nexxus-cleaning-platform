'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AccountAddCardPanel } from '@/components/redesign/shared/payment-methods/AccountAddCardPanel';

export interface OrgAddCardSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string;
  /** Called with the newly-saved PaymentMethod id after confirmSetup succeeds. */
  onSaved: (paymentMethodId: string) => void | Promise<void>;
}

/**
 * Add a company (self-pay) card. Reuses the shared SetupIntent -> confirmSetup panel, pointed at
 * the org SetupIntent route (which creates the intent against the org's self-pay Customer, so the
 * client confirmSetup attaches the card to it automatically). The container makes the new card the
 * default after it saves.
 */
export function OrgAddCardSheet({ open, onOpenChange, organizationId, onSaved }: OrgAddCardSheetProps) {
  // While a card save (incl. 3DS) is in flight, block swipe/overlay dismissal so the confirmSetup
  // call is never unmounted mid-flight. Reset whenever the sheet closes.
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) setSaving(false);
  }, [open]);

  const createSetupIntent = useCallback(async (): Promise<string> => {
    const token = await getAccessToken();
    const res = await fetch('/api/stripe/org/create-setup-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ organization_id: organizationId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.client_secret) throw new Error(data.error || 'Could not start card setup');
    return data.client_secret as string;
  }, [organizationId]);

  return (
    // Settings is a desktop surface: a right-side Sheet, matching every other detail sheet
    // (BookingDetailSheet etc.), not the mobile bottom Drawer.
    <Sheet open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add a company card</SheetTitle>
          <SheetDescription>
            This card funds self-pay cleanings your company books. You will not be charged now.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {/* Mount the panel only while open so each open fetches a fresh SetupIntent. */}
          {open && (
            <AccountAddCardPanel
              createSetupIntent={createSetupIntent}
              onSaved={onSaved}
              onSavingChange={setSaving}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
