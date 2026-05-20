"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";

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

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700">
          Preferred date &amp; time
          <span className="text-gray-500 font-normal">
            {" "}
            (primary required, up to {maxSlots - 1} alternates)
          </span>
        </label>
        {slots.length < maxSlots && (
          <button
            type="button"
            onClick={addSlot}
            className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> Add alternate
          </button>
        )}
      </div>
      <div className="space-y-2">
        {slots.map((slot, idx) => {
          const minTimeForRow =
            todayLocalStr && slot.date === todayLocalStr ? minTimeForToday : undefined;
          return (
            <div key={idx} className="flex items-center gap-2">
              <div className="text-xs font-medium text-gray-500 w-16 flex-shrink-0">
                {idx === 0 ? "Primary" : `Alt ${idx}`}
              </div>
              <input
                type="date"
                min={minDate}
                value={slot.date}
                onChange={(e) => updateSlot(idx, "date", e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <input
                type="time"
                min={minTimeForRow}
                value={slot.time}
                onChange={(e) => updateSlot(idx, "time", e.target.value)}
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              {idx > 0 ? (
                <button
                  type="button"
                  onClick={() => removeSlot(idx)}
                  className="p-2 text-gray-400 hover:text-red-500 flex-shrink-0"
                  aria-label="Remove alternate"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : (
                <div className="w-8 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
