// src/components/redesign/settings/sections/CancellationSection.tsx
"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateOrgPaymentSettings } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

type FeeType = "none" | "flat" | "percent";
interface PolicyForm {
  cancellationWindowHours: string;
  cancellationFeeType: FeeType;
  cancellationFeeValue: string;
  noShowFeeType: FeeType;
  noShowFeeValue: string;
}
const FEE_TYPES: { value: FeeType; label: string }[] = [
  { value: "none", label: "No fee" },
  { value: "flat", label: "Flat amount" },
  { value: "percent", label: "Percent of job" },
];

export function CancellationSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<PolicyForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("cancellation_window_hours, cancellation_fee_type, cancellation_fee_value, no_show_fee_type, no_show_fee_value")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      cancellationWindowHours: String(data?.cancellation_window_hours ?? 24),
      cancellationFeeType: (data?.cancellation_fee_type as FeeType) ?? "none",
      cancellationFeeValue: String(data?.cancellation_fee_value ?? 0),
      noShowFeeType: (data?.no_show_fee_type as FeeType) ?? "none",
      noShowFeeValue: String(data?.no_show_fee_value ?? 0),
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: PolicyForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgPaymentSettings(currentOrganizationId, {
      cancellation_window_hours: parseInt(v.cancellationWindowHours, 10) || 0,
      cancellation_fee_type: v.cancellationFeeType,
      cancellation_fee_value: parseFloat(v.cancellationFeeValue) || 0,
      no_show_fee_type: v.noShowFeeType,
      no_show_fee_value: parseFloat(v.noShowFeeValue) || 0,
    });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<PolicyForm>({ load, save, successMessage: "Cancellation policy updated" });

  if (loading || !value) return <SectionSkeleton />;

  return (
    <div>
      <SectionHeader title="Cancellation policy" lead="What happens when a booking is cancelled late or missed." />
      <SettingRow label="Free-cancel window" htmlFor="cx-window" helper="Cancellations before this many hours are free.">
        <Input
          id="cx-window"
          className="sm:w-32"
          type="number"
          min={0}
          max={720}
          value={value.cancellationWindowHours}
          onChange={(e) => setValue({ ...value, cancellationWindowHours: e.target.value })}
        />
      </SettingRow>
      <SettingRow label="Late cancellation fee">
        <div className="flex items-center gap-2">
          <Select
            value={value.cancellationFeeType}
            onValueChange={(t) => setValue({ ...value, cancellationFeeType: t as FeeType })}
          >
            <SelectTrigger className="w-40" aria-label="Cancellation fee type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEE_TYPES.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value.cancellationFeeType !== "none" && (
            <Input
              className="w-28"
              type="number"
              min={0}
              step={value.cancellationFeeType === "percent" ? 1 : 0.01}
              max={value.cancellationFeeType === "percent" ? 100 : undefined}
              value={value.cancellationFeeValue}
              onChange={(e) => setValue({ ...value, cancellationFeeValue: e.target.value })}
            />
          )}
        </div>
      </SettingRow>
      <SettingRow label="No-show fee" helper="Charged when the customer is not home at the scheduled time.">
        <div className="flex items-center gap-2">
          <Select
            value={value.noShowFeeType}
            onValueChange={(t) => setValue({ ...value, noShowFeeType: t as FeeType })}
          >
            <SelectTrigger className="w-40" aria-label="No-show fee type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEE_TYPES.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value.noShowFeeType !== "none" && (
            <Input
              className="w-28"
              type="number"
              min={0}
              step={value.noShowFeeType === "percent" ? 1 : 0.01}
              max={value.noShowFeeType === "percent" ? 100 : undefined}
              value={value.noShowFeeValue}
              onChange={(e) => setValue({ ...value, noShowFeeValue: e.target.value })}
            />
          )}
        </div>
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
