'use client';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

export interface RemoveCardSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Human label for the card being removed, e.g. "Visa •••• 4242". */
  label: string;
  removing: boolean;
  onConfirm: () => void;
}

export function RemoveCardSheet({ open, onOpenChange, label, removing, onConfirm }: RemoveCardSheetProps) {
  return (
    <Drawer open={open} onOpenChange={(v) => !removing && onOpenChange(v)}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Remove this card?</DrawerTitle>
          <DrawerDescription>
            {label} will be removed from your saved payment methods.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button
            onClick={onConfirm}
            loading={removing}
            className="w-full bg-critical text-white hover:bg-critical/90"
          >
            Remove card
          </Button>
          <Button variant="ghost" className="w-full" disabled={removing} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
