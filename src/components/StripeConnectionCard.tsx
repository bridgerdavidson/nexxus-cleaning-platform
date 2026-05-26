"use client";

import React, { useState } from "react";
import {
  CheckCircle,
  Loader2,
  AlertCircle,
  Link2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { useStripeConnect } from "../hooks/useStripeConnect";
import CleanerStripeConnect from "./CleanerStripeConnect";

interface StripeConnectionCardProps {
  compact?: boolean;
}

/**
 * Cleaner payout status widget for the dashboard. Shows the Connect status at a glance and,
 * when setup is incomplete, reveals the EMBEDDED onboarding inline (no redirect / new tab) —
 * the full embedded experience also lives in Settings → Payouts (`CleanerStripeConnect`).
 */
export default function StripeConnectionCard({
  compact = false,
}: StripeConnectionCardProps) {
  const {
    enabled,
    connectStatus,
    statusLoading,
    dashboardLoading,
    connectError,
    handleOpenStripeDashboard,
  } = useStripeConnect();

  const [showSetup, setShowSetup] = useState(false);

  if (!enabled) return null;

  const cardClass = compact
    ? "bg-white rounded-2xl border border-gray-200 p-5"
    : "bg-white rounded-3xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] border border-gray-100/80 p-8 md:p-12 mb-6 md:mb-10";

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-3 mb-3">
        <Link2 className="w-4 h-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900">Stripe Account</h3>
      </div>

      {connectError && (
        <div className="mb-3 flex items-start gap-2 text-red-600 text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{connectError}</span>
        </div>
      )}

      {statusLoading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs text-gray-500">Checking status…</span>
        </div>
      ) : connectStatus?.onboarding_complete ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-green-600" />
            </div>
            <span className="text-sm font-medium text-green-700">Connected</span>
          </div>
          <button
            onClick={handleOpenStripeDashboard}
            disabled={dashboardLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-primary-700 bg-primary-50 rounded-xl hover:bg-primary-100 disabled:opacity-60 transition-colors"
          >
            {dashboardLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                Open Stripe <ExternalLink className="w-3 h-3" />
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {connectStatus?.has_account ? (
              <>
                <div className="w-7 h-7 bg-yellow-100 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                </div>
                <span className="text-sm font-medium text-yellow-700">Setup incomplete</span>
              </>
            ) : (
              <span className="text-sm text-gray-500">Not connected</span>
            )}
          </div>
          <button
            onClick={() => setShowSetup((s) => !s)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 transition-colors"
          >
            {showSetup ? "Hide" : connectStatus?.has_account ? "Finish setup" : "Set up payouts"}
          </button>
        </div>
      )}

      {/* Embedded onboarding inline — never leaves the app. */}
      {showSetup && !connectStatus?.onboarding_complete && (
        <div className="mt-4">
          <CleanerStripeConnect />
        </div>
      )}
    </div>
  );
}
