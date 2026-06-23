"use client";

import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import TenantStripeConnect from "@/components/TenantStripeConnect";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";

/**
 * The org's OWN money: the embedded Stripe ConnectPayouts table (accurate balance,
 * next payout, and bank deposits), themed with redesign tokens so the chrome feels
 * native. Onboarding / viewer / drift / skeleton states are all handled inside
 * TenantStripeConnect; this only frames it.
 */
export function PaymentsYourMoney() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your money</CardTitle>
        <CardDescription>
          {"Your Stripe balance, the next payout on its way, and what's already landed in your bank."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TenantStripeConnect appearance={getRedesignConnectAppearance(isDark)} />
      </CardContent>
    </Card>
  );
}
