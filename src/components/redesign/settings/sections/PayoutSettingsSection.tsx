// src/components/redesign/settings/sections/PayoutSettingsSection.tsx
"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { updateOrgProfile, updateOrgCleanerPayouts } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

type PayoutModel = "percentage_contractor" | "hourly_external";
interface PayoutForm { model: PayoutModel; defaultPct: string }

export function PayoutSettingsSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<PayoutForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("default_payout_model, default_cleaner_payout_percent")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      model: (data?.default_payout_model as PayoutModel) ?? "percentage_contractor",
      defaultPct: String(data?.default_cleaner_payout_percent ?? 50),
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: PayoutForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgProfile(currentOrganizationId, { default_payout_model: v.model });
    const pct = parseFloat(v.defaultPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Default payout % must be between 0 and 100");
    await updateOrgCleanerPayouts(currentOrganizationId, { default_cleaner_payout_percent: pct });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<PayoutForm>({ load, save, successMessage: "Payout settings updated" });

  if (loading || !value) return <SectionSkeleton />;

  return (
    <div>
      <SectionHeader title="Payout settings" lead="How your cleaners get paid. Per-cleaner overrides live in the Cleaners screen." />
      <SettingRow label="Payout model" helper="Only percentage payouts are available today.">
        <RadioGroup value={value.model} onValueChange={(m) => setValue({ ...value, model: m as PayoutModel })} className="gap-3">
          <div className="flex items-center gap-2">
            <RadioGroupItem id="pm-pct" value="percentage_contractor" />
            <Label htmlFor="pm-pct" className="font-medium">Percentage of each job</Label>
          </div>
          <div className="flex items-center gap-2 opacity-50">
            <RadioGroupItem id="pm-hourly" value="hourly_external" disabled />
            <Label htmlFor="pm-hourly" className="font-medium">Hourly (coming soon)</Label>
          </div>
        </RadioGroup>
      </SettingRow>
      <SettingRow label="Default cleaner payout %" htmlFor="pm-default" helper="Applied to new cleaners unless overridden.">
        <Input id="pm-default" className="sm:w-28" type="number" min={0} max={100} value={value.defaultPct}
          onChange={(e) => setValue({ ...value, defaultPct: e.target.value })} />
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
