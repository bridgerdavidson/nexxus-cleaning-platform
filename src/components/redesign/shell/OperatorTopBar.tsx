"use client";

import { Bell, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Profile = { firstName?: string; lastName?: string; avatarUrl?: string };

function initials(p?: Profile) {
  const f = p?.firstName?.[0] ?? "";
  const l = p?.lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "OP";
}

/**
 * Operator top bar: global search + primary "New booking" action + notifications
 * + profile menu. Sits to the right of the rail on desktop (parent offsets it).
 */
export function OperatorTopBar({ onNewBooking }: { onNewBooking?: () => void }) {
  const { user, signOut } = useAuth() as { user: { profile?: Profile } | null; signOut: () => void };
  const profile = user?.profile;
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Operator";

  return (
    <header className="sticky top-0 z-30 h-[56px] border-b border-border bg-card">
      {/* inner content capped to the same width as the page content (1700px) so edges align on wide screens */}
      <div className="flex h-full max-w-[1700px] items-center gap-3 px-4 lg:px-6">
      {/* search — full on sm+, icon on mobile */}
      <div className="relative hidden flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor="op-search" className="sr-only">Search</label>
        <Input
          id="op-search"
          type="search"
          placeholder="Search bookings, customers, cleaners…"
          className="h-9 rounded-pill pl-9"
        />
      </div>
      <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Search">
        <Search className="h-5 w-5" aria-hidden />
      </Button>

      <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
        <Button onClick={onNewBooking} className="hidden sm:inline-flex">
          <Plus className="h-4 w-4" aria-hidden />
          New booking
        </Button>

        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-5 w-5" aria-hidden />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-info ring-2 ring-card" aria-hidden />
        </Button>

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
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem destructive onClick={() => signOut()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>
    </header>
  );
}
