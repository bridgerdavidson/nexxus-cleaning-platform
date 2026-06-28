"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateOrgCleanerExperience } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";

type CleanerPayDisplay = "full" | "payout_only";

interface CleanerExperienceForm {
  cleaner_pay_display: CleanerPayDisplay;
  require_job_photos: boolean;
}

export function CleanerExperienceSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<CleanerExperienceForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("cleaner_pay_display, require_job_photos")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      cleaner_pay_display: (data?.cleaner_pay_display as CleanerPayDisplay) ?? "full",
      require_job_photos: data?.require_job_photos ?? true,
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: CleanerExperienceForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgCleanerExperience(currentOrganizationId, {
      cleaner_pay_display: v.cleaner_pay_display,
      require_job_photos: v.require_job_photos,
    });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, onSave, onDiscard } =
    useSettingsSection<CleanerExperienceForm>({
      load,
      save,
      successMessage: "Cleaner experience settings saved.",
    });

  if (loading || !value) return <SectionSkeleton />;

  return (
    <div>
      <SectionHeader
        title="Cleaner experience"
        lead="Control what your cleaners see and are required to do when completing a job."
      />
      <SettingRow
        label="Pay visibility"
        helper="Choose how much financial detail cleaners see when they complete a job."
      >
        <RadioGroup
          value={value.cleaner_pay_display}
          onValueChange={(v) =>
            setValue({ ...value, cleaner_pay_display: v as CleanerPayDisplay })
          }
          className="space-y-3"
        >
          <div className="flex items-start gap-3">
            <RadioGroupItem value="full" id="cpd-full" className="mt-0.5" />
            <div>
              <Label htmlFor="cpd-full" className="font-medium">
                Show the full breakdown
              </Label>
              <p className="text-sm text-muted-foreground">
                Cleaners see what the customer was charged and their payout.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="payout_only" id="cpd-payout-only" className="mt-0.5" />
            <div>
              <Label htmlFor="cpd-payout-only" className="font-medium">
                Show payout only
              </Label>
              <p className="text-sm text-muted-foreground">
                Cleaners see only their own payout, not the customer charge.
              </p>
            </div>
          </div>
        </RadioGroup>
      </SettingRow>
      <SettingRow
        label="Require job photos"
        htmlFor="require-job-photos"
        helper="Cleaners must add a before and after photo (or give a reason) before completing a job."
      >
        <Switch
          id="require-job-photos"
          checked={value.require_job_photos}
          onCheckedChange={(checked) =>
            setValue({ ...value, require_job_photos: checked })
          }
        />
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
