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
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSaveBar } from "../SettingsSaveBar";

type PayoutModel = "percentage" | "flat" | "request" | "hourly_external";
interface PayoutForm { model: PayoutModel; defaultPct: string; marginPct: string }

const MODEL_OPTIONS: { value: PayoutModel; label: string; description: string; disabled?: boolean }[] = [
  {
    value: "percentage",
    label: "Percentage of each job",
    description: "Each cleaner takes a set percent of every job.",
  },
  {
    value: "flat",
    label: "Flat amount per job",
    description: "Each cleaner earns a set dollar amount per completed job.",
  },
  {
    value: "request",
    label: "Cleaner requests their pay",
    description:
      "Cleaners name their pay after each job. Requests within your margin approve automatically; the rest come to you.",
  },
  {
    value: "hourly_external",
    label: "Hourly (coming soon)",
    description: "Hourly pay runs outside the platform for now.",
    disabled: true,
  },
];

/** Live example so the margin number is concrete: "$350 job -> requests up to $280". */
function marginExample(marginPct: number): string | null {
  if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > 100) return null;
  const bps = Math.round(marginPct * 100);
  const maxCents = Math.floor((35000 * (10000 - bps)) / 10000);
  const dollars = maxCents / 100;
  const label = `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: maxCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
  return `Example: on a $350 job, requests up to ${label} approve automatically.`;
}

export function PayoutSettingsSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<PayoutForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("default_payout_model, default_cleaner_payout_percent, min_margin_bps")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Rows written before migration 118 may still carry the old spelling;
    // normalize for display so the radio group always has a selected item.
    const raw = (data?.default_payout_model as string | null) ?? "percentage";
    return {
      model: (raw === "percentage_contractor" ? "percentage" : raw) as PayoutModel,
      defaultPct: String(data?.default_cleaner_payout_percent ?? 50),
      marginPct: String((Number(data?.min_margin_bps ?? 2000)) / 100),
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: PayoutForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    // Validate before any network write so an invalid number never half-persists a model change.
    const pct = parseFloat(v.defaultPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Default payout % must be between 0 and 100");
    const margin = parseFloat(v.marginPct);
    if (!Number.isFinite(margin) || margin < 0 || margin > 100)
      throw new Error("Auto-approve margin must be between 0 and 100");
    await updateOrgProfile(currentOrganizationId, { default_payout_model: v.model });
    await updateOrgCleanerPayouts(currentOrganizationId, {
      default_cleaner_payout_percent: pct,
      min_margin_bps: Math.round(margin * 100),
    });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, loadError, retry, onSave, onDiscard } =
    useSettingsSection<PayoutForm>({ load, save, successMessage: "Payout settings updated" });

  if (loading) return <SectionSkeleton />;
  if (loadError || !value)
    return <ErrorState title="Couldn't load this section" onRetry={retry} />;

  const example = marginExample(parseFloat(value.marginPct));

  return (
    <div>
      <SectionHeader title="Payout settings" lead="How your cleaners get paid. Per-cleaner overrides live in the Cleaners screen." />
      <SettingRow label="Payout model" helper="The default for new cleaners. Change any one cleaner's mode from their profile.">
        <RadioGroup
          value={value.model}
          onValueChange={(m) => setValue({ ...value, model: m as PayoutModel })}
          className="gap-3 sm:w-80"
        >
          {MODEL_OPTIONS.map((opt) => (
            <div key={opt.value} className={`flex items-start gap-2 ${opt.disabled ? "opacity-50" : ""}`}>
              <RadioGroupItem id={`pm-${opt.value}`} value={opt.value} disabled={opt.disabled} className="mt-0.5" />
              <div className="space-y-0.5">
                <Label htmlFor={`pm-${opt.value}`} className="font-medium">{opt.label}</Label>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              </div>
            </div>
          ))}
        </RadioGroup>
      </SettingRow>
      <SettingRow label="Default cleaner payout %" htmlFor="pm-default" helper="Applied to new percentage-mode cleaners unless overridden.">
        <Input id="pm-default" className="sm:w-28" type="number" min={0} max={100} value={value.defaultPct}
          onChange={(e) => setValue({ ...value, defaultPct: e.target.value })} />
      </SettingRow>
      <SettingRow
        label="Auto-approve margin"
        htmlFor="pm-margin"
        helper="For cleaners who request their pay. Requests that leave you at least this share of the job price are approved automatically."
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input id="pm-margin" className="w-28" type="number" min={0} max={100} step="0.5" value={value.marginPct}
              onChange={(e) => setValue({ ...value, marginPct: e.target.value })} />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          {example ? <p className="max-w-64 text-xs text-muted-foreground">{example}</p> : null}
        </div>
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
