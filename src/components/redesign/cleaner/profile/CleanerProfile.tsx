"use client";

import { useEffect, useState } from "react";
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
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function onConfirmSignOut() {
    setSigningOut(true);
    await signOut();
    // On success the auth listener routes to /login; keep the spinner until then.
  }

  // Resync the form to the auth profile when it changes externally (late
  // hydration, sign-in, account switch). In-progress edits never change
  // user.profile, so they are not clobbered; after a successful save the stored
  // values match the local ones, so this is a no-op.
  useEffect(() => {
    setFirstName(user?.profile.firstName ?? "");
    setLastName(user?.profile.lastName ?? "");
    setPhone(formatPhoneDisplay(normalizePhoneToDigits(user?.profile.phone ?? "")));
  }, [user?.profile.firstName, user?.profile.lastName, user?.profile.phone]);

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
    <>
      {/* Page h1: the top bar now carries the company logo (white-label PR 4). */}
      <h1 className="mb-4 text-2xl font-extrabold leading-tight">Profile</h1>
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
      signOutOpen={signOutOpen}
      signingOut={signingOut}
      onSignOutOpenChange={setSignOutOpen}
      onSignOut={() => setSignOutOpen(true)}
      onConfirmSignOut={() => {
        void onConfirmSignOut();
      }}
    />
    </>
  );
}
