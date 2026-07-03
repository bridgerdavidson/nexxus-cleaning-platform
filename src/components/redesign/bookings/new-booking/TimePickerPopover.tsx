'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { bookableTimeOptions, toYMD } from '@/components/redesign/homeowner/booking/time-options';
import type { OperatorBookingSlot } from './operator-booking-types';

/** "Add a time" trigger that opens a calendar + time popover and reports the chosen slot. */
export function TimePickerPopover({
  onAdd,
  label = 'Add a time',
}: {
  onAdd: (slot: OperatorBookingSlot) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState<string | null>(null);
  const times = bookableTimeOptions();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setDate(undefined);
          setTime(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-control border border-dashed border-border py-2.5 text-sm font-bold text-brand-700 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden /> {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <Calendar mode="single" selected={date} onSelect={setDate} disabled={{ before: today }} />
        {date && (
          <div className="mt-2 flex max-w-[264px] flex-wrap gap-2">
            {times.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTime(t.value)}
                className={
                  'rounded-pill border px-2.5 py-1.5 text-xs font-bold transition-colors ' +
                  (time === t.value
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-input bg-card hover:bg-muted')
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <Button
          className="mt-3 w-full"
          size="sm"
          disabled={!date || !time}
          onClick={() => {
            if (date && time) {
              onAdd({ date: toYMD(date), time });
              setOpen(false);
            }
          }}
        >
          Add this time
        </Button>
      </PopoverContent>
    </Popover>
  );
}
