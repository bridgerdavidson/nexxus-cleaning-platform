"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadMessageCount } from "@/hooks/useUnreadMessageCount";
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
        <HomeownerBottomNav activeId={activeId} messagesUnread={messagesUnread} />
      </div>
    </TooltipProvider>
  );
}
