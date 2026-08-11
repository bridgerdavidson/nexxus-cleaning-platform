// src/components/redesign/settings/sections/PaymentsSection.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import TenantStripeConnect from "@/components/TenantStripeConnect";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { stripeSelfPayUiEnabled } from "@/lib/stripe/flags";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/error-state";
import { updateOrgProfile } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { SettingsSaveBar } from "../SettingsSaveBar";
import { OrgPaymentMethods } from "../payment-methods/OrgPaymentMethods";

export function PaymentsSection() {
  const { resolvedTheme } = useTheme();
  const { currentOrganizationId, currentOrgRole } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-10">
      <div>
        <SectionHeader title="Payments" lead="Your Stripe Connect account. You are the merchant of record for every charge." />
        {mounted ? (
          <TenantStripeConnect appearance={getRedesignConnectAppearance(resolvedTheme === "dark")} />
        ) : (
          <Skeleton className="h-40 w-full rounded-card" />
        )}
      </div>

      {stripeSelfPayUiEnabled() && currentOrganizationId ? (
        <div>
          <SectionHeader
            title="Company payment methods"
            lead="The card your company is charged when it books a self-pay cleaning (a cleaning at a company-owned property)."
          />
          <OrgPaymentMethods />
        </div>
      ) : null}

      {/* The profile route behind this is owner-only; hide it from the
          admin/manager callers who can otherwise see the Payments section. */}
      {currentOrgRole === "owner" ? <BillingEmailBlock /> : null}
    </div>
  );
}

interface BillingEmailForm { billingEmail: string }

/** Owner-only billing contact. One field, its own save bar. */
function BillingEmailBlock() {
  const { currentOrganizationId } = useAuth();

  const load = useCallback(async (): Promise<BillingEmailForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("billing_email")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { billingEmail: (data?.billing_email as string | null) ?? "" };
  }, [currentOrganizationId]);

  const save = useCallback(async (v: BillingEmailForm) => {
    if (!currentOrganizationId) throw new Error("No organization");
    await updateOrgProfile(currentOrganizationId, {
      billing_email: v.billingEmail.trim() || null,
    });
  }, [currentOrganizationId]);

  const { value, setValue, loading, saving, isDirty, loadError, retry, onSave, onDiscard } =
    useSettingsSection<BillingEmailForm>({ load, save, successMessage: "Billing email updated" });

  if (loading) return <SectionSkeleton />;
  if (loadError || !value)
    return <ErrorState title="Couldn't load billing email" onRetry={retry} />;

  return (
    <div>
      <SectionHeader title="Billing" lead="Your company's billing contact." />
      <SettingRow
        label="Billing email"
        htmlFor="org-billing-email"
        helper="Prefills your Stripe account setup. Your subscription invoices will also be sent here."
      >
        <Input
          id="org-billing-email"
          className="sm:w-72"
          type="email"
          value={value.billingEmail}
          onChange={(e) => setValue({ ...value, billingEmail: e.target.value })}
        />
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
