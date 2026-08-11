'use client';

import { MessageCircle } from 'lucide-react';
import { PersonPicker, PersonPickerRow } from '@/components/redesign/messages/PersonPicker';
import { initialsFromFullName } from '@/components/redesign/messages/messages-format';
import type { MessageableCleaning } from './messageableCleanings';

export interface NewConversationSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hasOffice: boolean;
  cleanings: MessageableCleaning[];
  /** When false (org kill-switch off), the "message a cleaning" section is hidden
   *  entirely, so only the office option shows. Defaults to true. */
  messagingEnabled?: boolean;
  onPickOffice: () => void;
  onPickCleaning: (appointmentId: string) => void;
}

export function NewConversationSheet({
  open,
  onOpenChange,
  hasOffice,
  cleanings,
  messagingEnabled = true,
  onPickOffice,
  onPickCleaning,
}: NewConversationSheetProps) {
  return (
    <PersonPicker open={open} onOpenChange={onOpenChange} title="New conversation">
      {hasOffice && (
        <PersonPickerRow
          icon={<MessageCircle className="size-5" />}
          title="Message office"
          onSelect={() => {
            onPickOffice();
            onOpenChange(false);
          }}
        />
      )}

      {messagingEnabled && (
        <>
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            Message about a cleaning
          </p>

          {cleanings.length === 0 ? (
            <p className="px-3 pb-2 text-sm text-muted-foreground">
              You can message a cleaner once a cleaning is confirmed.
            </p>
          ) : (
            cleanings.map((c) => (
              <PersonPickerRow
                key={c.appointmentId}
                initials={initialsFromFullName(c.cleanerName)}
                title={c.cleanerName}
                subtitle={`${c.dateLabel}, ${c.serviceLabel}`}
                onSelect={() => {
                  onPickCleaning(c.appointmentId);
                  onOpenChange(false);
                }}
              />
            ))
          )}
        </>
      )}
    </PersonPicker>
  );
}
