'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getAccessToken } from '@/lib/auth/clientAccessToken';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { AccountAddCardPanel } from './AccountAddCardPanel';

export interface AddCardSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the newly-saved PaymentMethod id after confirmSetup succeeds. */
  onSaved: (paymentMethodId: string) => void | Promise<void>;
}

export function AddCardSheet({ open, onOpenChange, onSaved }: AddCardSheetProps) {
  const { user } = useAuth();
  const userId = user?.id;
  // While a card save (incl. 3DS) is in flight, block swipe/overlay dismissal so the
  // confirmSetup call is never unmounted mid-flight. Reset whenever the sheet closes.
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) setSaving(false);
  }, [open]);

  // Self-scoped SetupIntent: pass only homeowner_id (no organization_id) so the route treats
  // the caller as acting on their own Customer.
  const createSetupIntent = useCallback(async (): Promise<string> => {
    const token = await getAccessToken();
    const res = await fetch('/api/stripe/create-setup-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ homeowner_id: userId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.client_secret) throw new Error(data.error || 'Could not start card setup');
    return data.client_secret as string;
  }, [userId]);

  return (
    <Drawer open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Add a card</DrawerTitle>
          <DrawerDescription>
            Your card is saved securely for future cleanings. You will not be charged now.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          {/* Mount the panel only while open so each open fetches a fresh SetupIntent. */}
          {open && (
            <AccountAddCardPanel
              createSetupIntent={createSetupIntent}
              onSaved={onSaved}
              onSavingChange={setSaving}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
