'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, Loader2, AlertCircle, Link2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import AvatarUpload from './AvatarUpload';
import { formatPhoneDisplay, normalizePhoneToDigits } from '../lib/phone';

function stripeUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === 'true';
}

export default function ProfileSettingsPage() {
  const { user, updateProfile } = useAuth();

  const [firstName, setFirstName] = useState(user?.profile.firstName ?? '');
  const [lastName, setLastName] = useState(user?.profile.lastName ?? '');
  const [phone, setPhone] = useState(() => normalizePhoneToDigits(user?.profile.phone ?? ''));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Stripe Connect state (cleaner only)
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectStatus, setConnectStatus] = useState<{
    has_account: boolean;
    onboarding_complete: boolean;
    payouts_enabled: boolean;
  } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Sync phone from profile when it changes (e.g. after load or save)
  useEffect(() => {
    setPhone(normalizePhoneToDigits(user?.profile.phone ?? ''));
  }, [user?.profile.phone]);

  const fetchConnectStatus = useCallback(async () => {
    if (!user?.id || user.role !== 'cleaner' || !stripeUiEnabled()) return;

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
      }
    } catch {
      // Silently fail on initial load
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    fetchConnectStatus();
  }, [fetchConnectStatus]);

  // Handle ?stripe_return=true from Stripe onboarding redirect
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
      // Step 1: Create account if needed
      const createRes = await fetch('/api/stripe/connect/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaner_id: user.id }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create Stripe account');
      }

      // Step 2: Get onboarding link
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

  const handleAvatarUploadSuccess = (url: string) => {
    // Sync new avatar URL into the auth state (DB already updated by server route)
    updateProfile({ avatarUrl: url });
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const { error } = await updateProfile({ firstName, lastName, phone });

    setSaving(false);
    if (error) {
      setSaveError(error);
    } else {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account information and profile picture.
        </p>
      </div>

      {/* Avatar section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Profile Picture</h2>
        <div className="flex flex-col items-center">
          <AvatarUpload
            currentAvatarUrl={user.profile.avatarUrl}
            onUploadSuccess={handleAvatarUploadSuccess}
            size="lg"
          />
          <p className="mt-3 text-xs text-gray-400">
            JPEG, PNG or WebP · max 5 MB
          </p>
        </div>
      </div>

      {/* Profile info section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Personal Information</h2>

        <form onSubmit={handleProfileSave} className="space-y-4">
          {/* Email (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={user.email}
              readOnly
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">
              Email cannot be changed yet.
            </p>
          </div>

          {/* Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="First name"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Last name"
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={formatPhoneDisplay(phone)}
              onChange={(e) => setPhone(normalizePhoneToDigits(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="(555) 123-4567"
            />
          </div>

          {/* Role (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <input
              type="text"
              value={user.role}
              readOnly
              disabled
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm capitalize cursor-not-allowed"
            />
          </div>

          {/* Feedback */}
          {saveError && (
            <p className="text-sm text-red-600">{saveError}</p>
          )}
          {saveSuccess && (
            <div className="flex items-center gap-1.5 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>Profile saved successfully.</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Payout Account — cleaner only */}
      {user.role === 'cleaner' && stripeUiEnabled() && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Link2 className="w-5 h-5 text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">Payout Account</h2>
          </div>

          {connectError && (
            <div className="mb-4 flex items-start gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{connectError}</span>
            </div>
          )}

          {connectStatus?.onboarding_complete ? (
            <div className="flex items-center gap-3">
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
          ) : connectStatus?.has_account ? (
            <div>
              <p className="text-sm text-gray-600 mb-3">
                Your Stripe account has been created but setup is not complete.
                Finish onboarding to start receiving payouts.
              </p>
              <button
                onClick={handleConnectWithStripe}
                disabled={connectLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 transition-colors"
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
              <p className="text-sm text-gray-600 mb-3">
                Connect your Stripe account to receive automatic payouts when jobs are completed.
              </p>
              <button
                onClick={handleConnectWithStripe}
                disabled={connectLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-60 transition-colors"
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
      )}
    </div>
  );
}
