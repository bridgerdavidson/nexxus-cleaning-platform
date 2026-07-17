"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadMessageCount } from "@/hooks/useUnreadMessageCount";
import { useOpenBooking } from "../booking/useOpenBooking";
import { HomeownerTopBar } from "./HomeownerTopBar";
import { HomeownerBottomNav } from "./HomeownerBottomNav";
import { deriveHomeownerActive } from "./homeowner-nav-items";

/** Phone-first homeowner app shell: sticky top bar, a constrained content
 *  column (so it reads like a phone app on desktop), and a fixed bottom tab bar. */
export function HomeownerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeId = deriveHomeownerActive(pathname);
  const { user } = useAuth();
  const messagesUnread = useUnreadMessageCount(user?.id, 'all');
  const openBooking = useOpenBooking();
  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-dvh bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:shadow-soft-md focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <HomeownerTopBar />
        <main id="main-content" className="mx-auto max-w-lg px-4 pb-28 pt-4">
          {/* Keyed by pathname so each tab/page switch replays the entrance
              animation on the incoming content (the shell itself stays put). */}
          <div key={pathname} className="animate-page-in motion-reduce:animate-none">
            {children}
          </div>
        </main>
        {/* Request-a-cleaning FAB: the homeowner's one global action, so it
            persists on every tab except Account (management territory, where
            it would float over Sign out / form actions). Shell-owned so it
            survives tab switches; the max-w-lg wrapper pins it inside the
            phone column on desktop. z-30 keeps it under the bottom nav (z-40)
            and takeovers/sheets (z-50). */}
        {activeId !== "account" && (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg">
            <Button
              onClick={() => openBooking()}
              aria-label="Request a cleaning"
              className="pointer-events-auto absolute bottom-[88px] right-4 h-12 gap-2 rounded-pill px-4 shadow-soft-lg"
            >
              <CalendarPlus className="h-5 w-5" aria-hidden />
              <span className="text-sm font-semibold">Request a cleaning</span>
            </Button>
          </div>
        )}
        <HomeownerBottomNav activeId={activeId} messagesUnread={messagesUnread} />
      </div>
    </TooltipProvider>
  );
}
