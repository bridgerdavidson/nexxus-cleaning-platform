"use client";

import Link from "next/link";
import { NotificationBell } from "@/components/redesign/notifications/NotificationBell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { OrgLogo } from "@/components/branding/OrgLogo";
import { OrgSwitcherMenuItems } from "@/components/redesign/shared/OrgSwitcherMenuItems";

type Profile = { firstName?: string; lastName?: string; avatarUrl?: string };

function initials(p?: Profile) {
  const f = p?.firstName?.[0] ?? "";
  const l = p?.lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "ME";
}

/** Cleaner top bar: the cleaning company's logo on the left; notifications +
 *  profile menu on the right. No global search (operator-only). The greeting
 *  moved into the Today view as a real h1. */
export function CleanerTopBar() {
  const { user, signOut } = useAuth() as {
    user: { profile?: Profile } | null;
    signOut: () => void;
  };
  const profile = user?.profile;
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Cleaner";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-lg items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          {/* Uploaded lockups fit a 32x200 box: the width budget keeps a wide
              tight-cropped mark in check while a squarish one gets the full
              bar-scale height instead of shrinking to a sliver. */}
          <OrgLogo variant="full" size={32} imageMaxWidth={200} />
        </div>
        <NotificationBell role="cleaner" />
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Account menu"
          >
            <Avatar className="h-9 w-9">
              {profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={fullName} /> : null}
              <AvatarFallback>{initials(profile)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{fullName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/cleaner/profile">Profile</Link>
            </DropdownMenuItem>
            <OrgSwitcherMenuItems />
            <DropdownMenuItem destructive onClick={() => signOut()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
