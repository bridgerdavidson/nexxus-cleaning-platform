'use client';

import { LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';

type Profile = { firstName?: string; lastName?: string; avatarUrl?: string };

function initials(p?: Profile): string {
  const f = p?.firstName?.[0] ?? '';
  const l = p?.lastName?.[0] ?? '';
  return (f + l).toUpperCase() || 'PA';
}

/**
 * Platform back-office top bar: a context label + the account menu (Sign out).
 * Deliberately lean, no search / notifications / new-booking. Sign out lives
 * here so it stays reachable on every breakpoint (mobile bottom nav is nav-only).
 */
export function PlatformTopBar() {
  const { user, signOut } = useAuth() as {
    user: { profile?: Profile } | null;
    signOut: () => void;
  };
  const profile = user?.profile;
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Platform admin';

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-border bg-card">
      <div className="mx-auto flex h-full w-full max-w-[1700px] items-center gap-3 px-4 lg:px-6">
        <span className="text-sm font-semibold text-foreground">Platform Owner</span>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Account menu"
            >
              <Avatar className="h-8 w-8">
                {profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={name} /> : null}
                <AvatarFallback>{initials(profile)}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>{name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" aria-hidden />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
