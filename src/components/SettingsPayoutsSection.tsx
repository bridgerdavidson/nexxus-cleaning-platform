'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, Loader2, AlertCircle, Link2, ExternalLink } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

function stripeUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === 'true';
}

export default function SettingsPayoutsSection() {
  const { user } = useAuth();

  const [connectLoading, setConnectLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connectStatus, setConnectStatus] = useState<{
    has_account: boolean;
    onboarding_complete: boolean;
    payouts_enabled: boolean;
  } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const fetchConnectStatus = useCallback(async () => {
    if (!user?.id || user.role !== 'cleaner' || !stripeUiEnabled()) {
      setStatusLoading(false);
      return;
    }

    setStatusLoading(true);
    try {
      const res = await fetch('/api/stripe/connect/account-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const data = await res.json();
      if (data.success) {
        setConnectStatus({
          has_account: data.has_account,
          onboarding_complete: data.onboarding_complete,
          payouts_enabled: data.payouts_enabled,
        });
      } else {
        setConnectError('Unable to check payout status. Please try again.');
      }
    } catch {
      setConnectError('Unable to check payout status. Please try again.');
    } finally {
      setStatusLoading(false);
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    fetchConnectStatus();
  }, [fetchConnectStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe_return') === 'true' || params.get('stripe_refresh') === 'true') {
      fetchConnectStatus();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchConnectStatus]);

  const handleConnectWithStripe = async () => {
    if (!user?.id) return;
    setConnectLoading(true);
    setConnectError(null);

    try {
      const createRes = await fetch('/api/stripe/connect/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create Stripe account');
      }

      const linkRes = await fetch('/api/stripe/connect/onboarding-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const linkData = await linkRes.json();
      if (!linkRes.ok || !linkData.success) {
        throw new Error(linkData.error || 'Failed to get onboarding link');
      }

      window.location.href = linkData.url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Something went wrong');
      setConnectLoading(false);
    }
  };

  const [dashboardLoading, setDashboardLoading] = useState(false);

  const handleOpenStripeDashboard = async () => {
    if (!user?.id) return;
    setDashboardLoading(true);
    setConnectError(null);

    try {
      const res = await fetch('/api/stripe/connect/login-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to get Stripe dashboard link');
      }

      window.location.href = data.url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Something went wrong');
      setDashboardLoading(false);
    }
  };

  if (!user || user.role !== 'cleaner' || !stripeUiEnabled()) {
    return null;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900 mb-2">Payouts</h1>
        <p className="text-[15px] text-gray-500">
          Manage your Stripe Connect account for payouts.
        </p>
      </div>

      <div className="bg-white rounded-3xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] border border-gray-100/80 p-8 md:p-12 mb-6 md:mb-10 transition-all duration-300 group">
        <div className="flex items-center gap-3 mb-6 px-1 text-gray-400 group-hover:text-primary-600 transition-colors">
          <Link2 className="w-5 h-5 transition-colors" />
          <h2 className="text-[1.35rem] font-bold tracking-tight text-gray-900 group-hover:text-primary-600 transition-colors">Payout Account</h2>
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
                'Complete Stripe Setup'
              )}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-gray-500 mb-4 leading-relaxed">
              Connect your Stripe account to receive automatic payouts when jobs are completed.
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
                'Connect with Stripe'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
