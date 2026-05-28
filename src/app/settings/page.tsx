'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { defaultSectionForRole, SETTINGS_SECTIONS } from '@/lib/settings';
import MobileSettingsMenu from '@/components/settings/MobileSettingsMenu';

/**
 * /settings root.
 *
 * Desktop (>= md): server immediately can't gate; the client redirects to the
 * default section per role as soon as auth resolves. The menu list is hidden
 * by Tailwind (`md:hidden`).
 *
 * Mobile (< md): renders the menu list — `/settings` IS a destination.
 *
 * While auth is still resolving, we render the menu skeleton (visible on mobile,
 * hidden on desktop) so we never flash an empty page.
 */
export default function SettingsIndexPage() {
  const router = useRouter();
  const { user, currentOrgRole, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    // Desktop redirect to the role's default section. We only do this when
    // we know the viewport is desktop — on mobile, /settings is the menu
    // and the redirect would skip it.
    if (typeof window === 'undefined') return;
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    if (isDesktop) {
      const section = defaultSectionForRole(user.role, currentOrgRole ?? undefined);
      const target = SETTINGS_SECTIONS.find((s) => s.id === section)?.href;
      router.replace(target ?? '/settings/profile');
    }
  }, [loading, user, currentOrgRole, router]);

  return <MobileSettingsMenu />;
}
