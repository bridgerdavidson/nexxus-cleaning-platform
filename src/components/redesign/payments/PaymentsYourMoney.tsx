"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import TenantStripeConnect from "@/components/TenantStripeConnect";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";

/**
 * The org's OWN money: the embedded Stripe ConnectPayouts table (accurate balance,
 * next payout, and bank deposits), themed with redesign tokens so the chrome feels
 * native. Onboarding / viewer / drift / skeleton states are all handled inside
 * TenantStripeConnect; this only frames it.
 *
 * The Connect instance applies its appearance once (at init), and useTheme's
 * resolvedTheme is undefined on the first client render. So we hold the embed behind
 * a mounted gate until the theme resolves, guaranteeing the embed initializes with
 * the correct (light/dark) appearance instead of being stuck in light for the session.
 */
export function PaymentsYourMoney() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your money</CardTitle>
        <CardDescription>
          {"Your Stripe balance, the next payout on its way, and what's already landed in your bank."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mounted ? (
          <TenantStripeConnect appearance={getRedesignConnectAppearance(resolvedTheme === "dark")} />
        ) : (
          <Skeleton className="h-40 w-full rounded-card" />
        )}
      </CardContent>
    </Card>
  );
}
