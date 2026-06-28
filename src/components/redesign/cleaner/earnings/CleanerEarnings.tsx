// src/components/redesign/cleaner/earnings/CleanerEarnings.tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import CleanerStripeConnect, { cleanerStatusKind } from "@/components/CleanerStripeConnect";
import { useStripeConnect } from "@/hooks/useStripeConnect";
import { useCleanerAwaitingPayments, useCleanerStats } from "@/hooks/useCleanerData";
import { getRedesignConnectAppearance } from "@/lib/stripe/appearance";
import { deriveEarnings, shouldReveal } from "./deriveEarnings";
import { CleanerEarningsView } from "./CleanerEarningsView";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const STRIPE_ENABLED = process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function CleanerEarnings() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { connectStatus, statusLoading, connectError, dashboardLoading, handleOpenStripeDashboard } =
    useStripeConnect();
  const { awaitingPayments: awaiting } = useCleanerAwaitingPayments();
  const { stats } = useCleanerStats();

  const connectKind = cleanerStatusKind(connectStatus, statusLoading);

  // The reveal flag LATCHES: once true it never returns to false, so a post-activation
  // Stripe restriction (connectKind leaving 'active') can never unmount a live embed.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed((prev) => shouldReveal(prev, connectKind));
  }, [connectKind]);

  const stripeEnabled = STRIPE_ENABLED && !!PUBLISHABLE_KEY;

  const data = deriveEarnings({
    stripeEnabled,
    // Slice 6 wires the real organizations.default_payout_model; contractor is the live path today.
    payoutModel: "percentage_contractor",
    connectKind,
    awaiting,
    stats,
  });

  const appearance = getRedesignConnectAppearance(resolvedTheme === "dark");
  // The embed element is created here but only placed in the DOM by the View's revealed
  // branch. Because `revealed` latches, it mounts once and never unmounts.
  const embed = <CleanerStripeConnect appearance={appearance} />;

  return (
    <CleanerEarningsView
      data={data}
      mounted={mounted}
      revealed={revealed}
      todayStr={ymd(new Date())}
      embed={embed}
      onSetup={() => setRevealed(true)}
      onOpenStripe={() => {
        void handleOpenStripeDashboard();
      }}
      dashboardLoading={dashboardLoading}
      openStripeError={connectError}
    />
  );
}
