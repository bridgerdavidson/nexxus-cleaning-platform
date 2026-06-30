'use client';

import { MessageCircle } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import type { MessageableCleaning } from './messageableCleanings';

export interface NewConversationSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hasOffice: boolean;
  cleanings: MessageableCleaning[];
  onPickOffice: () => void;
  onPickCleaning: (appointmentId: string) => void;
}

const ROW =
  'flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]';

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function NewConversationSheet({
  open,
  onOpenChange,
  hasOffice,
  cleanings,
  onPickOffice,
  onPickCleaning,
}: NewConversationSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>New conversation</DrawerTitle>
        </DrawerHeader>

        <div className="space-y-2 px-4 pb-8">
          {hasOffice && (
            <button
              type="button"
              aria-label="Message office"
              className={ROW}
              onClick={() => {
                onPickOffice();
                onOpenChange(false);
              }}
            >
              <span
                aria-hidden
                className="grid size-11 shrink-0 place-items-center rounded-pill bg-primary/10 text-primary"
              >
                <MessageCircle className="size-5" />
              </span>
              <span className="text-sm font-bold">Message office</span>
            </button>
          )}

          <p className="px-0.5 pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Message about a cleaning
          </p>

          {cleanings.length === 0 ? (
            <p className="px-0.5 text-sm text-muted-foreground">
              You can message a cleaner once a cleaning is confirmed.
            </p>
          ) : (
            <div className="space-y-2">
              {cleanings.map((c) => (
                <button
                  key={c.appointmentId}
                  type="button"
                  aria-label={`Message ${c.cleanerName} about ${c.dateLabel} cleaning`}
                  className={ROW}
                  onClick={() => {
                    onPickCleaning(c.appointmentId);
                    onOpenChange(false);
                  }}
                >
                  <Avatar className="size-11 shrink-0">
                    <AvatarFallback>{initialsFromName(c.cleanerName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{c.cleanerName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.dateLabel}, {c.serviceLabel}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
