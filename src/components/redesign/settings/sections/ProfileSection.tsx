"use client";
import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AvatarEditor } from "@/components/redesign/shared/AvatarEditor";
import { personInitials } from "@/lib/initials";
import { Input } from "@/components/ui/input";
import { formatPhoneDisplay, normalizePhoneToDigits } from "@/lib/phone";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSaveBar } from "../SettingsSaveBar";

interface ProfileForm { firstName: string; lastName: string; phone: string }

export function ProfileSection() {
  const { user, updateProfile } = useAuth();

  const load = useCallback(async (): Promise<ProfileForm> => ({
    firstName: user?.profile.firstName ?? "",
    lastName: user?.profile.lastName ?? "",
    phone: normalizePhoneToDigits(user?.profile.phone ?? ""),
  }), [user?.profile.firstName, user?.profile.lastName, user?.profile.phone]);

  const save = useCallback(async (v: ProfileForm) => {
    const res = await updateProfile({ firstName: v.firstName, lastName: v.lastName, phone: v.phone });
    if (res.error) throw new Error(res.error);
  }, [updateProfile]);

  const { value, setValue, loading, saving, isDirty, loadError, retry, onSave, onDiscard } =
    useSettingsSection<ProfileForm>({ load, save, successMessage: "Profile updated" });

  if (loading) return <SectionSkeleton />;
  if (loadError || !value)
    return <ErrorState title="Couldn't load this section" onRetry={retry} />;

  const avatarInitials =
    personInitials(value.firstName, value.lastName) ||
    user?.email?.charAt(0)?.toUpperCase() ||
    "U";

  return (
    <div>
      <SectionHeader title="Profile" lead="Your personal account details." />
      <SettingRow label="Profile photo" helper="PNG or JPG, at least 200x200.">
        <AvatarEditor
          currentAvatarUrl={user?.profile.avatarUrl}
          initials={avatarInitials}
          onUploaded={(url) => updateProfile({ avatarUrl: url })}
        />
      </SettingRow>
      <SettingRow label="First name" htmlFor="profile-first">
        <Input id="profile-first" className="sm:w-64" value={value.firstName}
          onChange={(e) => setValue({ ...value, firstName: e.target.value })} />
      </SettingRow>
      <SettingRow label="Last name" htmlFor="profile-last">
        <Input id="profile-last" className="sm:w-64" value={value.lastName}
          onChange={(e) => setValue({ ...value, lastName: e.target.value })} />
      </SettingRow>
      <SettingRow label="Phone" htmlFor="profile-phone">
        <Input id="profile-phone" className="sm:w-64" inputMode="tel" value={formatPhoneDisplay(value.phone)}
          onChange={(e) => setValue({ ...value, phone: normalizePhoneToDigits(e.target.value) })} />
      </SettingRow>
      <SettingRow label="Email" helper="Used for sign-in. Contact support to change it.">
        <span className="text-sm text-muted-foreground">{user?.email}</span>
      </SettingRow>
      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
    </div>
  );
}
