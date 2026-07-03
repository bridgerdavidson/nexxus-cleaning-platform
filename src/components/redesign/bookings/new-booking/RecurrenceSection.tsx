'use client';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type {
  CadencePreset,
  CustomRecurrenceType,
  OperatorBookingSlot,
  OperatorRecurrence,
  RecurrenceEnd,
} from './operator-booking-types';
import { recurrenceRecap, weekdayOfYmd, parseYmdLocalNoon } from './deriveRecurrence';

const PRESETS: { key: CadencePreset; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'every4', label: 'Every 4 weeks' },
  { key: 'custom', label: 'Custom' },
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function chipDate(ymd: string): string {
  return parseYmdLocalNoon(ymd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function RecurrenceSection({
  value,
  startSlot,
  occurrences,
  onChange,
}: {
  value: OperatorRecurrence;
  startSlot: OperatorBookingSlot | null;
  occurrences: string[];
  onChange: (patch: Partial<OperatorRecurrence>) => void;
}) {
  const isWeekly = value.preset !== 'custom' || value.customType === 'weekly';
  const effectiveDays =
    value.daysOfWeek.length > 0 ? value.daysOfWeek : startSlot ? [weekdayOfYmd(startSlot.date)] : [];

  function toggleDay(idx: number) {
    const current = value.daysOfWeek.length > 0 ? value.daysOfWeek : effectiveDays;
    const next = current.includes(idx) ? current.filter((d) => d !== idx) : [...current, idx];
    // Never allow an empty selection: keep the current set if a toggle would clear it.
    onChange({ daysOfWeek: (next.length === 0 ? current : next).slice().sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-3 rounded-card border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">Repeat this cleaning</span>
        <Switch
          checked={value.enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
          aria-label="Repeat this cleaning"
        />
      </div>

      {value.enabled && !startSlot && (
        <p className="text-sm text-muted-foreground">Pick a date and time first to set up a repeat.</p>
      )}

      {value.enabled && startSlot && (
        <div className="space-y-4">
          {/* Cadence presets */}
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                type="button"
                variant={value.preset === p.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => onChange({ preset: p.key })}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Custom controls */}
          {value.preset === 'custom' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Every</span>
              <Input
                type="number"
                min={1}
                max={12}
                value={value.customInterval}
                onChange={(e) => onChange({ customInterval: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                className="w-20"
                aria-label="Repeat interval"
              />
              <Select value={value.customType} onValueChange={(v) => onChange({ customType: v as CustomRecurrenceType })}>
                <SelectTrigger className="w-36" aria-label="Repeat unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">days</SelectItem>
                  <SelectItem value="weekly">weeks</SelectItem>
                  <SelectItem value="monthly">months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Day chips (weekly cadences) */}
          {isWeekly && (
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((d, idx) => {
                const on = effectiveDays.includes(idx);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    aria-pressed={on}
                    className={
                      'rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ' +
                      (on ? 'bg-brand-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}

          {/* Ends */}
          <RadioGroup
            value={value.end}
            onValueChange={(v) => onChange({ end: v as RecurrenceEnd })}
            className="space-y-2"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="after" />
              <span>After</span>
              {value.end === 'after' && (
                <>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={value.count}
                    onChange={(e) => onChange({ count: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                    className="w-20"
                    aria-label="Number of cleanings"
                  />
                  <span className="text-muted-foreground">cleanings</span>
                </>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="on_date" />
              <span>On date</span>
              {value.end === 'on_date' && (
                <Input
                  type="date"
                  min={startSlot.date}
                  value={value.endDate ?? ''}
                  onChange={(e) => onChange({ endDate: e.target.value || null })}
                  className="w-44"
                  aria-label="End date"
                />
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="keep_going" />
              <span>Keep going</span>
              {value.end === 'keep_going' && <span className="text-muted-foreground">up to 6 months</span>}
            </label>
          </RadioGroup>

          {/* Recap + preview */}
          <div className="space-y-2 rounded-card border border-border bg-muted/40 p-3">
            <p className="text-sm font-semibold">
              {recurrenceRecap(value, startSlot.date, startSlot.time, occurrences)}
            </p>
            {occurrences.length === 0 ? (
              <p className="text-xs font-medium text-critical">
                This repeat does not produce any cleanings. Adjust the days or the end.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {occurrences.slice(0, 5).map((d) => (
                  <Badge key={d} variant="secondary">
                    {chipDate(d)}
                  </Badge>
                ))}
                {occurrences.length > 5 && <Badge variant="secondary">+{occurrences.length - 5} more</Badge>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
