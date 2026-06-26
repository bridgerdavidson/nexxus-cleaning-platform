// src/components/redesign/settings/sections/BusinessHoursSection.tsx
"use client";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateOrgBusinessHours } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
interface DayHours { open: string; close: string; closed: boolean }
type Hours = Record<DayKey, DayHours>;
interface HoursForm { timezone: string; hours: Hours }

const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Monday" }, { key: "tue", label: "Tuesday" }, { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" }, { key: "fri", label: "Friday" }, { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

const DEFAULT_HOURS: Hours = {
  mon: { open: "08:00", close: "17:00", closed: false }, tue: { open: "08:00", close: "17:00", closed: false },
  wed: { open: "08:00", close: "17:00", closed: false }, thu: { open: "08:00", close: "17:00", closed: false },
  fri: { open: "08:00", close: "17:00", closed: false }, sat: { open: "09:00", close: "14:00", closed: false },
  sun: { open: "09:00", close: "14:00", closed: true },
};

function listTimezones(): string[] {
  try {
    const tz = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (tz && tz.length) return tz;
  } catch { /* fall through */ }
  return ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
    "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris", "UTC"];
}

export function BusinessHoursSection() {
  const { currentOrganizationId } = useAuth();
  const timezones = useMemo(listTimezones, []);

  const load = useCallback(async (): Promise<HoursForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("timezone, business_hours")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      timezone: (data?.timezone as string | null) ?? "America/New_York",
      hours: { ...DEFAULT_HOURS, ...((data?.business_hours as Partial<Hours> | null) ?? {}) },
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: HoursForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgBusinessHours(currentOrganizationId, { timezone: v.timezone, business_hours: v.hours });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<HoursForm>({ load, save, successMessage: "Business hours updated" });

  if (loading || !value) return <SectionSkeleton />;

  const tzOptions = timezones.includes(value.timezone) ? timezones : [value.timezone, ...timezones];
  const setDay = (key: DayKey, patch: Partial<DayHours>) =>
    setValue({ ...value, hours: { ...value.hours, [key]: { ...value.hours[key], ...patch } } });

  return (
    <div>
      <SectionHeader title="Business hours" lead="Drives default availability and scheduling bounds." />
      <SettingRow label="Timezone" htmlFor="bh-tz">
        <Select value={value.timezone} onValueChange={(tz) => setValue({ ...value, timezone: tz })}>
          <SelectTrigger className="sm:w-72" aria-label="Timezone"><SelectValue /></SelectTrigger>
          <SelectContent>{tzOptions.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
        </Select>
      </SettingRow>
      {DAYS.map(({ key, label }) => {
        const row = value.hours[key];
        return (
          <SettingRow key={key} label={label}>
            <div className="flex items-center gap-3">
              {row.closed ? (
                <span className="text-sm text-muted-foreground">Closed</span>
              ) : (
                <>
                  <Input className="w-32" type="time" value={row.open} onChange={(e) => setDay(key, { open: e.target.value })} />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input className="w-32" type="time" value={row.close} onChange={(e) => setDay(key, { close: e.target.value })} />
                </>
              )}
              <Switch checked={!row.closed} onCheckedChange={(open) => setDay(key, { closed: !open })} aria-label={`${label} open`} />
            </div>
          </SettingRow>
        );
      })}
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
