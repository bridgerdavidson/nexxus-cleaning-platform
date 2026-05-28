'use client';

import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import SettingsProfileSection from '@/components/SettingsProfileSection';

export default function ProfileSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        section="Profile"
        title="Profile"
        description="How your name, photo, and contact info appear across Nexxus."
      />
      <SettingsProfileSection />
    </>
  );
}
