'use client';

import { useEffect, useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { bookableTimeOptions, toYMD } from './time-options';
import type { BookingSlot } from './booking-types';

export interface TimePickerSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (slot: BookingSlot) => void;
}

export function TimePickerSheet({ open, onOpenChange, onAdd }: TimePickerSheetProps) {
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState<string | null>(null);
  const times = bookableTimeOptions();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Reset each open so a fresh preferred time starts blank.
  useEffect(() => {
    if (open) {
      setDate(undefined);
      setTime(null);
    }
  }, [open]);

  const dateLabel = date
    ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Pick a preferred time</DrawerTitle>
        </DrawerHeader>
        <div className="max-h-[72vh] overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="flex justify-center">
            <Calendar mode="single" selected={date} onSelect={setDate} disabled={{ before: today }} />
          </div>

          {date && (
            <>
              <p className="mb-2 mt-3 px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Time on {dateLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                {times.map((t) => {
                  const on = time === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTime(t.value)}
                      className={
                        'rounded-pill border px-3 py-2 text-xs font-bold transition-colors ' +
                        (on
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-input bg-card text-foreground hover:bg-muted')
                      }
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <Button
            className="mt-4 w-full"
            disabled={!date || !time}
            onClick={() => {
              if (date && time) {
                onAdd({ date: toYMD(date), time });
                onOpenChange(false);
              }
            }}
          >
            Add this time
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
