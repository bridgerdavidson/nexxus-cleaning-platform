'use client';

import { ShieldCheck } from 'lucide-react';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import ComingSoonSection from '@/components/settings/ComingSoonSection';

export default function SecuritySettingsPage() {
  return (
    <>
      <SettingsPageHeader
        section="Security"
        title="Security"
        description="Password management and two-factor authentication."
      />
      <ComingSoonSection
        icon={ShieldCheck}
        title="Security settings coming soon"
        description="Change your password and turn on two-factor authentication from this page. Until then, contact your admin for any account changes."
      />
    </>
  );
}
