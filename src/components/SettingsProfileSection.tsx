'use client';

import React, { useState, useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import AvatarUpload from './AvatarUpload';
import { formatPhoneDisplay, normalizePhoneToDigits } from '../lib/phone';

export default function SettingsProfileSection() {
  const { user, updateProfile } = useAuth();

  const [firstName, setFirstName] = useState(user?.profile.firstName ?? '');
  const [lastName, setLastName] = useState(user?.profile.lastName ?? '');
  const [phone, setPhone] = useState(() => normalizePhoneToDigits(user?.profile.phone ?? ''));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setPhone(normalizePhoneToDigits(user?.profile.phone ?? ''));
  }, [user?.profile.phone]);

  const handleAvatarUploadSuccess = (url: string) => {
    if (updateProfile) {
      updateProfile({ avatarUrl: url });
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !updateProfile) return;

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
    <div>
      {/* Avatar section */}
      <div className="card mb-6 md:mb-8 group">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900 mb-6 group-hover:text-primary-600 transition-colors">Profile Picture</h2>
        <div className="flex flex-col items-center pt-4 pb-4">
          <AvatarUpload
            currentAvatarUrl={user.profile.avatarUrl}
            onUploadSuccess={handleAvatarUploadSuccess}
            size="lg"
          />
          <p className="mt-5 text-sm text-gray-400 font-medium">
            JPEG, PNG or WebP · max 5 MB
          </p>
        </div>
      </div>

      {/* Profile info section */}
      <div className="card mb-6 md:mb-8 group">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900 mb-6 group-hover:text-primary-600 transition-colors">Personal Information</h2>

        <form onSubmit={handleProfileSave} className="space-y-7">
          {/* Email (read-only) */}
          <div>
              <label className="block text-[13px] uppercase tracking-widest font-bold text-gray-500 mb-2.5 ml-1">
              Email
            </label>
            <input
              type="email"
              value={user.email}
              readOnly
              disabled
              className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm cursor-not-allowed focus:outline-none shadow-sm"
            />
            <p className="text-sm text-gray-500 mt-2 ml-0.5">
              Email cannot be changed yet.
            </p>
          </div>

          {/* Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-[13px] uppercase tracking-widest font-bold text-gray-500 mb-2.5 ml-1">
                First name
              </label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors shadow-sm"
                placeholder="First name"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-[13px] uppercase tracking-widest font-bold text-gray-500 mb-2.5 ml-1">
                Last name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors shadow-sm"
                placeholder="Last name"
              />
            </div>
          </div>

          {/* Phone */}
          <div>
              <label htmlFor="phone" className="block text-[13px] uppercase tracking-widest font-bold text-gray-500 mb-2.5 ml-1">
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={formatPhoneDisplay(phone)}
              onChange={(e) => setPhone(normalizePhoneToDigits(e.target.value))}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors shadow-sm"
              placeholder="(555) 123-4567"
            />
          </div>

          {/* Role (read-only) */}
          <div>
              <label className="block text-[13px] uppercase tracking-widest font-bold text-gray-500 mb-2.5 ml-1">
              Role
            </label>
            <input
              type="text"
              value={user.role}
              readOnly
              disabled
              className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm capitalize cursor-not-allowed focus:outline-none shadow-sm"
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

          <div className="flex justify-end pt-8 mt-10 border-t border-gray-100">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary w-full sm:w-auto"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
