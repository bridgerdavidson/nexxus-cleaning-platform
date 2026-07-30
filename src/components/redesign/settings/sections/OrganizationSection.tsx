"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { updateOrgProfile } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSaveBar } from "../SettingsSaveBar";

interface OrgForm { name: string; logoUrl: string; billingEmail: string }

export function OrganizationSection() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<OrgForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("name, logo_url, billing_email")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      name: data?.name ?? "",
      logoUrl: (data?.logo_url as string | null) ?? "",
      billingEmail: (data?.billing_email as string | null) ?? "",
    };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: OrgForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgProfile(currentOrganizationId, {
      name: v.name.trim(),
      logo_url: v.logoUrl.trim() || null,
      billing_email: v.billingEmail.trim() || null,
    });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, loadError, retry, onSave, onDiscard } =
    useSettingsSection<OrgForm>({ load, save, successMessage: "Organization updated" });

  if (loading) return <SectionSkeleton />;
  if (loadError || !value)
    return <ErrorState title="Couldn't load this section" onRetry={retry} />;

  return (
    <div>
      <SectionHeader title="Organization" lead="How your cleaning company shows up across the app." />
      <SettingRow label="Company name" htmlFor="org-name" helper="Shown to customers and on invoices.">
        <Input id="org-name" className="sm:w-72" maxLength={200} value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })} />
      </SettingRow>
      <SettingRow label="Logo URL" htmlFor="org-logo" helper="Paste an image URL.">
        <Input id="org-logo" className="sm:w-72" type="url" value={value.logoUrl}
          onChange={(e) => setValue({ ...value, logoUrl: e.target.value })} />
      </SettingRow>
      <SettingRow label="Billing email" htmlFor="org-billing" helper="Where receipts and Stripe notices are sent.">
        <Input id="org-billing" className="sm:w-72" type="email" value={value.billingEmail}
          onChange={(e) => setValue({ ...value, billingEmail: e.target.value })} />
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
