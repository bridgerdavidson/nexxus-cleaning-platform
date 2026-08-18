// src/components/redesign/settings/sections/PayoutSettingsSection.tsx
"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { useOrgQuery } from "@/lib/useOrgQuery";
import { keys } from "@/lib/queryKeys";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { updateOrgProfile, updateOrgCleanerPayouts } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSaveBar } from "../SettingsSaveBar";

// The org level answers ONE question: are cleaners paid per job through Nexxus,
// or hourly outside it. Every per-job specific (percentage / flat / requests
// their pay) is set per cleaner, on that cleaner. The old four-mode picker here
// only stamped a default onto later invites, which read as an org-wide switch
// but wasn't one; per-cleaner modes replaced it.
type PayCategory = "per_job" | "hourly";
interface PayoutForm {
  category: PayCategory;
  /** The raw stored default_payout_model at load time, so save() knows whether
   *  picking "per job" is a real category change (hourly org) or a no-op. */
  storedModel: string;
  defaultPct: string;
  marginPct: string;
  /** Whether the org has ever saved this section (payout_configured_at). While
   *  false the save bar stays visible even on a clean form, so accepting the
   *  defaults is a saveable action and the setup checklist can complete. */
  confirmed: boolean;
}

const CATEGORY_OPTIONS: { value: PayCategory; label: string; description: string; disabled?: boolean }[] = [
  {
    value: "per_job",
    label: "Paid per job, through Nexxus",
    description:
      "For teams paid per completed job: contractor-based cleaning companies, property managers, short-term rental operators, offices, anyone who needs cleaning managed. Each cleaner's pay (a percent, a flat rate, or naming their pay) is set on that cleaner, in Cleaners & team.",
  },
  {
    value: "hourly",
    label: "Hourly, paid outside Nexxus (coming soon)",
    description: "For companies that run their own payroll. Cleaners get assigned jobs and set availability; pay stays off the platform.",
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
  const qc = useQueryClient();
  // Flips after a successful save so the confirm bar retires immediately
  // (useSettingsSection never re-runs load after a save).
  const [confirmedNow, setConfirmedNow] = useState(false);

  // Cleaners with no pay decision yet (active only). Drives the nudge row below;
  // disappears once every cleaner is configured.
  const { data: unconfiguredCount } = useOrgQuery({
    queryKey: ["settings", "payout", "unconfigured-count", currentOrganizationId ?? ""],
    queryFn: async ({ orgId }) => {
      const { count, error } = await supabase
        .from("cleaner_profiles")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("payout_configured_at", null)
        .is("deactivated_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const load = useCallback(async (): Promise<PayoutForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("default_payout_model, default_cleaner_payout_percent, min_margin_bps, payout_configured_at")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const storedModel = (data?.default_payout_model as string | null) ?? "percentage";
    return {
      category: storedModel === "hourly_external" ? "hourly" : "per_job",
      storedModel,
      defaultPct: String(data?.default_cleaner_payout_percent ?? 50),
      marginPct: String((Number(data?.min_margin_bps ?? 2000)) / 100),
      confirmed: data?.payout_configured_at != null,
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: PayoutForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    // Validate before any network write so an invalid number never half-persists.
    const pct = parseFloat(v.defaultPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("Percent prefill must be between 0 and 100");
    const margin = parseFloat(v.marginPct);
    if (!Number.isFinite(margin) || margin < 0 || margin > 100)
      throw new Error("Auto-approve margin must be between 0 and 100");
    // The category writes only on a REAL change (an hourly org picking per-job);
    // for a per-job org it is already true and nothing model-shaped is sent.
    if (v.category === "per_job" && v.storedModel === "hourly_external") {
      await updateOrgProfile(currentOrganizationId, { default_payout_model: "percentage" });
    }
    await updateOrgCleanerPayouts(currentOrganizationId, {
      default_cleaner_payout_percent: pct,
      min_margin_bps: Math.round(margin * 100),
    });
    // Saving (even with untouched defaults) stamps payout_configured_at, which
    // completes the "Set cleaner pay" setup-checklist step on the overview.
    setConfirmedNow(true);
    void qc.invalidateQueries({ queryKey: keys.onboarding.operator(currentOrganizationId) });
  }, [currentOrganizationId, qc]);

  const { value, setValue, loading, saving, isDirty, loadError, retry, onSave, onDiscard } =
    useSettingsSection<PayoutForm>({ load, save, successMessage: "Payout settings updated" });

  if (loading) return <SectionSkeleton />;
  if (loadError || !value)
    return <ErrorState title="Couldn't load this section" onRetry={retry} />;

  const example = marginExample(parseFloat(value.marginPct));
  const needsConfirm = !value.confirmed && !confirmedNow;

  return (
    <div>
      <SectionHeader
        title="Payout settings"
        lead="How your cleaners get paid. Each cleaner's own pay is set on that cleaner, in Cleaners & team."
      />
      <SettingRow
        label="How cleaners are paid"
        helper="The one org-wide choice. Everything else about pay lives on each cleaner."
      >
        <RadioGroup
          value={value.category}
          onValueChange={(m) => setValue({ ...value, category: m as PayCategory })}
          className="gap-3 sm:w-80"
        >
          {CATEGORY_OPTIONS.map((opt) => (
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
      {unconfiguredCount ? (
        <SettingRow
          label="Cleaners without pay set"
          helper="They cannot be paid for a job until it is set."
        >
          <p className="text-sm text-foreground">
            {unconfiguredCount === 1
              ? "1 cleaner still needs their pay set."
              : `${unconfiguredCount} cleaners still need their pay set.`}{" "}
            <Link href="/admin/cleaners" className="font-medium text-foreground hover:underline">
              Set it in Cleaners &amp; team
            </Link>
          </p>
        </SettingRow>
      ) : null}
      <SettingRow
        label="Percent prefill for new cleaners"
        htmlFor="pm-default"
        helper="Prefills the percent field the first time you set a cleaner to percentage pay. It never pays anyone on its own."
      >
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
      <SettingsSaveBar
        visible={isDirty || needsConfirm}
        saving={saving}
        onSave={onSave}
        onDiscard={onDiscard}
        message={isDirty ? "Unsaved changes" : "Confirm these settings to finish this setup step"}
        saveLabel={isDirty ? "Save changes" : "These look good"}
        showDiscard={isDirty}
      />
    </div>
  );
}
