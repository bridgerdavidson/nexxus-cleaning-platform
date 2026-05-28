'use client';

import { Bell } from 'lucide-react';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import ComingSoonSection from '@/components/settings/ComingSoonSection';

export default function NotificationsSettingsPage() {
  return (
    <>
      <SettingsPageHeader
        section="Notifications"
        title="Notifications"
        description="Choose how Nexxus reaches you about bookings, messages, and payments."
      />
      <ComingSoonSection
        icon={Bell}
        title="Notification preferences coming soon"
        description="Configure email, SMS, and push notifications independently per channel. We'll let you know when this lands."
      />
    </>
  );
}
