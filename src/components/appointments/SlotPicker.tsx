"use client";

import React from "react";
import { Plus, Trash2, Calendar, Clock } from "lucide-react";

export interface SlotInput {
  date: string;
  time: string;
}

interface SlotPickerProps {
  slots: SlotInput[];
  onChange: (slots: SlotInput[]) => void;
  minDate: string;
  /** Bound time range for "today" — e.g. server-relative "now" guard. Optional. */
  minTimeForToday?: string;
  todayLocalStr?: string;
  maxSlots?: number;
}

const SLOT_LABELS = ["First choice", "Second choice", "Third choice"];

export default function SlotPicker({
  slots,
  onChange,
  minDate,
  minTimeForToday,
  todayLocalStr,
  maxSlots = 3,
}: SlotPickerProps) {
  const addSlot = () => {
    if (slots.length >= maxSlots) return;
    onChange([...slots, { date: "", time: "" }]);
  };
  const removeSlot = (idx: number) => {
    if (idx === 0) return;
    onChange(slots.filter((_, i) => i !== idx));
  };
  const updateSlot = (idx: number, key: keyof SlotInput, value: string) => {
    onChange(slots.map((s, i) => (i === idx ? { ...s, [key]: value } : s)));
  };

  const backupsAllowed = maxSlots - 1;

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Preferred times</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          We&apos;ll try your first choice first.
          {backupsAllowed > 0
            ? ` Add up to ${backupsAllowed} ${backupsAllowed === 1 ? "backup" : "backups"} for the best chance.`
            : ""}
        </p>
      </div>

      <div className="space-y-3">
        {slots.map((slot, idx) => {
          const minTimeForRow =
            todayLocalStr && slot.date === todayLocalStr ? minTimeForToday : undefined;
          const label = SLOT_LABELS[idx] ?? `Choice ${idx + 1}`;
          return (
            <div
              key={idx}
              className="rounded-xl border border-gray-200 bg-white p-4 focus-within:ring-1 focus-within:ring-primary-200 focus-within:border-primary-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-sm font-semibold flex items-center justify-center flex-shrink-0"
                    aria-hidden="true"
                  >
                    {idx + 1}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{label}</span>
                </div>
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => removeSlot(idx)}
                    className="p-2 -m-2 text-gray-400 hover:text-red-500 transition-colors"
                    aria-label={`Remove ${label.toLowerCase()}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 min-w-0">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="date"
                    min={minDate}
                    value={slot.date}
                    onChange={(e) => updateSlot(idx, "date", e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                    aria-label={`${label} date`}
                  />
                </div>
                <div className="relative sm:w-40 flex-shrink-0">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="time"
                    min={minTimeForRow}
                    value={slot.time}
                    onChange={(e) => updateSlot(idx, "time", e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                    aria-label={`${label} time`}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {slots.length < maxSlots && (
          <button
            type="button"
            onClick={addSlot}
            className="w-full py-3 border-2 border-dashed border-gray-300 hover:border-primary-500 hover:bg-primary-50 text-gray-600 hover:text-primary-700 rounded-xl flex items-center justify-center gap-2 font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add another time
          </button>
        )}
      </div>
    </div>
  );
}
