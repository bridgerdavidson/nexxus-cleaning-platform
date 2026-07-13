// src/components/redesign/settings/sections/PaymentsSection.tsx
"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import TenantStripeConnect from "@/components/TenantStripeConnect";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { stripeSelfPayUiEnabled } from "@/lib/stripe/flags";
import { SectionHeader } from "../SettingRow";
import { OrgPaymentMethods } from "../payment-methods/OrgPaymentMethods";

export function PaymentsSection() {
  const { resolvedTheme } = useTheme();
  const { currentOrganizationId } = useAuth();
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
    </div>
  );
}
