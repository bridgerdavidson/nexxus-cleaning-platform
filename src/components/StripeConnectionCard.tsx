"use client";

import React from "react";
import {
  CheckCircle,
  Loader2,
  AlertCircle,
  Link2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { useStripeConnect } from "../hooks/useStripeConnect";

interface StripeConnectionCardProps {
  compact?: boolean;
}

export default function StripeConnectionCard({
  compact = false,
}: StripeConnectionCardProps) {
  const {
    enabled,
    connectStatus,
    statusLoading,
    connectLoading,
    dashboardLoading,
    connectError,
    handleConnectWithStripe,
    handleOpenStripeDashboard,
  } = useStripeConnect();

  if (!enabled) return null;

  if (compact) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-3 mb-3">
          <Link2 className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">
            Stripe Account
          </h3>
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
              <span className="text-sm font-medium text-green-700">
                Connected
              </span>
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
        ) : connectStatus?.has_account ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-yellow-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-yellow-600" />
              </div>
              <span className="text-sm font-medium text-yellow-700">
                Setup incomplete
              </span>
            </div>
            <button
              onClick={handleConnectWithStripe}
              disabled={connectLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors"
            >
              {connectLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Finish Setup"
              )}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Not connected</span>
            <button
              onClick={handleConnectWithStripe}
              disabled={connectLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-60 transition-colors"
            >
              {connectLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Connect Stripe"
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Full-size card (used in Settings)
  return (
    <div className="bg-white rounded-3xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] border border-gray-100/80 p-8 md:p-12 mb-6 md:mb-10 transition-all duration-300 group">
      <div className="flex items-center gap-3 mb-6 px-1 text-gray-400 group-hover:text-primary-600 transition-colors">
        <Link2 className="w-5 h-5 transition-colors" />
        <h2 className="text-[1.35rem] font-bold tracking-tight text-gray-900 group-hover:text-primary-600 transition-colors">
          Payout Account
        </h2>
      </div>

      {connectError && (
        <div className="mb-4 flex items-start gap-2 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{connectError}</span>
        </div>
      )}

      {statusLoading ? (
        <div className="flex items-center gap-3 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm text-gray-500">Checking payout status…</span>
        </div>
      ) : connectStatus?.onboarding_complete ? (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">Payouts Active</p>
              <p className="text-sm text-gray-500">
                Your Stripe account is connected and ready to receive payouts.
              </p>
            </div>
          </div>
          <button
            onClick={handleOpenStripeDashboard}
            disabled={dashboardLoading}
            className="inline-flex items-center gap-2 px-8 py-4 bg-primary-600 text-white text-[14.5px] font-semibold rounded-[1.25rem] hover:bg-primary-700 disabled:opacity-60 transition-all duration-300 shadow-[0_4px_12px_-2px_rgba(217,167,24,0.3)] hover:shadow-[0_8px_20px_-4px_rgba(217,167,24,0.4)] hover:-translate-y-0.5 active:translate-y-0"
          >
            {dashboardLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Opening Dashboard…
              </>
            ) : (
              <>
                Open Stripe Dashboard
                <ExternalLink className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      ) : connectStatus?.has_account ? (
        <div>
          <p className="text-gray-500 mb-4 leading-relaxed">
            Your Stripe account has been created but setup is not complete.
            Finish onboarding to start receiving payouts.
          </p>
          <button
            onClick={handleConnectWithStripe}
            disabled={connectLoading}
            className="inline-flex items-center gap-2 px-8 py-4 mt-4 bg-primary-600 text-white text-[14.5px] font-semibold rounded-[1.25rem] hover:bg-primary-700 disabled:opacity-60 transition-all duration-300 shadow-[0_4px_12px_-2px_rgba(217,167,24,0.3)] hover:shadow-[0_8px_20px_-4px_rgba(217,167,24,0.4)] hover:-translate-y-0.5 active:translate-y-0"
          >
            {connectLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Redirecting…
              </>
            ) : (
              "Complete Stripe Setup"
            )}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-gray-500 mb-4 leading-relaxed">
            Connect your Stripe account to receive automatic payouts when jobs
            are completed.
          </p>
          <button
            onClick={handleConnectWithStripe}
            disabled={connectLoading}
            className="inline-flex items-center gap-2 px-8 py-4 mt-4 bg-primary-600 text-white text-[14.5px] font-semibold rounded-[1.25rem] hover:bg-primary-700 disabled:opacity-60 transition-all duration-300 shadow-[0_4px_12px_-2px_rgba(217,167,24,0.3)] hover:shadow-[0_8px_20px_-4px_rgba(217,167,24,0.4)] hover:-translate-y-0.5 active:translate-y-0"
          >
            {connectLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Redirecting…
              </>
            ) : (
              "Connect with Stripe"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
