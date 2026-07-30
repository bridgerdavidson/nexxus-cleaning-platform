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
import { OrgSwitcherMenuItems } from "@/components/redesign/shared/OrgSwitcherMenuItems";

type Profile = { firstName?: string; lastName?: string; avatarUrl?: string };

function initials(p?: Profile) {
  const f = p?.firstName?.[0] ?? "";
  const l = p?.lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "ME";
}

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Cleaner top bar: greeting + first name on the left; notifications + profile
 *  menu on the right. No global search (operator-only). */
export function CleanerTopBar() {
  const { user, signOut } = useAuth() as {
    user: { profile?: Profile } | null;
    signOut: () => void;
  };
  const profile = user?.profile;
  const first = profile?.firstName || "there";
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Cleaner";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-lg items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{greeting(new Date())}</p>
          <p className="truncate text-lg font-extrabold leading-tight">{first}</p>
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
