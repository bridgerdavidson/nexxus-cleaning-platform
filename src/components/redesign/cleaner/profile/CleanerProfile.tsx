"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/toast";
import { formatPhoneDisplay, normalizePhoneToDigits } from "@/lib/phone";
import { cleanerInitials, showAvailabilityPlaceholder } from "./deriveProfile";
import { CleanerProfileView } from "./CleanerProfileView";

export function CleanerProfile() {
  const { user, updateProfile, signOut, currentOrganization } = useAuth();

  const baseFirst = user?.profile.firstName ?? "";
  const baseLast = user?.profile.lastName ?? "";
  const basePhoneDigits = normalizePhoneToDigits(user?.profile.phone ?? "");

  const [firstName, setFirstName] = useState(baseFirst);
  const [lastName, setLastName] = useState(baseLast);
  const [phone, setPhone] = useState(formatPhoneDisplay(basePhoneDigits));
  const [saving, setSaving] = useState(false);

  const isDirty =
    firstName.trim() !== baseFirst.trim() ||
    lastName.trim() !== baseLast.trim() ||
    normalizePhoneToDigits(phone) !== basePhoneDigits;

  async function onSave() {
    setSaving(true);
    const res = await updateProfile({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: normalizePhoneToDigits(phone),
    });
    setSaving(false);
    if (res.error) {
      toast.error("Could not save your profile", { description: res.error });
      return;
    }
    setPhone(formatPhoneDisplay(normalizePhoneToDigits(phone)));
    toast.success("Profile saved");
  }

  function onDiscard() {
    setFirstName(baseFirst);
    setLastName(baseLast);
    setPhone(formatPhoneDisplay(basePhoneDigits));
  }

  async function onAvatarUploaded(url: string) {
    // The upload pipeline already wrote user_profiles.avatar_url; this syncs the
    // in-memory auth profile so the new photo shows immediately app-wide.
    const res = await updateProfile({ avatarUrl: url });
    if (res.error) toast.error("Photo uploaded, but the profile didn't refresh", { description: res.error });
    else toast.success("Photo updated");
  }

  if (!user) return null;

  return (
    <CleanerProfileView
      initials={cleanerInitials({ firstName, lastName })}
      avatarUrl={user.profile.avatarUrl}
      email={user.email}
      firstName={firstName}
      lastName={lastName}
      phoneDisplay={phone}
      onFirstName={setFirstName}
      onLastName={setLastName}
      onPhone={setPhone}
      isDirty={isDirty}
      saving={saving}
      onSave={onSave}
      onDiscard={onDiscard}
      onAvatarUploaded={onAvatarUploaded}
      showAvailability={showAvailabilityPlaceholder(currentOrganization?.default_payout_model)}
      onSignOut={() => {
        void signOut();
      }}
    />
  );
}
