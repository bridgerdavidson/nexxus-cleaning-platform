// src/components/redesign/settings/sections/PaymentsSection.tsx
"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import TenantStripeConnect from "@/components/TenantStripeConnect";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "../SettingRow";

export function PaymentsSection() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div>
      <SectionHeader title="Payments" lead="Your Stripe Connect account. You are the merchant of record for every charge." />
      {mounted ? (
        <TenantStripeConnect appearance={getRedesignConnectAppearance(resolvedTheme === "dark")} />
      ) : (
        <Skeleton className="h-40 w-full rounded-card" />
      )}
    </div>
  );
}
