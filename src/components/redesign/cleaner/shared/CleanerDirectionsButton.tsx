'use client';

import React, { useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { appleMapsUrl, googleMapsUrl } from './job-presenters';

interface MapsOptionRowProps {
  href: string;
  label: string;
  onClose: () => void;
}

function MapsOptionRow({ href, label, onClose }: MapsOptionRowProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClose}
      className="flex min-h-[44px] items-center gap-3 rounded-control border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted active:bg-muted transition-colors"
    >
      <MapPin className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      {label}
    </a>
  );
}

export interface CleanerDirectionsButtonProps {
  address: string;
  className?: string;
}

/**
 * Renders an `outline` Button labelled "Directions". On tap, opens a bottom
 * sheet letting the user pick Apple Maps or Google Maps.
 *
 * Returns null when `address` is empty so callers can pass a possibly-missing
 * address without extra guards.
 */
export function CleanerDirectionsButton({ address, className }: CleanerDirectionsButtonProps) {
  const [open, setOpen] = useState(false);

  if (!address) return null;

  return (
    <>
      <Button
        variant="outline"
        size="default"
        className={cn('gap-2', className)}
        onClick={() => setOpen(true)}
        aria-label="Get directions"
      >
        <Navigation className="size-5" aria-hidden />
        Directions
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Open in maps</DrawerTitle>
          </DrawerHeader>

          <div className="px-5 pb-1 space-y-2.5">
            <MapsOptionRow
              href={appleMapsUrl(address)}
              label="Apple Maps"
              onClose={() => setOpen(false)}
            />
            <MapsOptionRow
              href={googleMapsUrl(address)}
              label="Google Maps"
              onClose={() => setOpen(false)}
            />
          </div>

          <DrawerFooter>
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
