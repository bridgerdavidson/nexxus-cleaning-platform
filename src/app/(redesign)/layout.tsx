// src/app/(redesign)/layout.tsx
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/ui/theme-provider";

// The redesign is the app (cutover complete, Phase 4). The build-time 404 gate
// that used to hide the tree behind NEXT_PUBLIC_REDESIGN_ENABLED is gone; the
// flag is retired. Still deliberately NOT force-dynamic: keeping the tree
// statically prerenderable is what lets <Link> fully prefetch each tab so
// bottom-nav taps commit instantly instead of blocking on a server round trip
// (the "dead tap" bug).
export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">
        {children}
        <Toaster position="top-right" />
      </div>
    </ThemeProvider>
  );
}
