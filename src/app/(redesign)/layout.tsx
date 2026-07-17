// src/app/(redesign)/layout.tsx
import { notFound } from "next/navigation";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { redesignUiEnabled } from "@/lib/redesign/flags";

// Redesign screens are reachable in local dev, on Vercel preview, OR in any
// environment where NEXT_PUBLIC_REDESIGN_ENABLED === "true". With the flag off
// in production the tree 404s, so in-progress screens never leak. The gate is
// evaluated at build time (deliberately NOT force-dynamic): all three inputs
// are fixed per deployment anyway (NEXT_PUBLIC_* is inlined into the client
// bundle at build), and keeping the tree statically prerenderable is what lets
// <Link> fully prefetch each tab so bottom-nav taps commit instantly instead
// of blocking on a server round trip (the "dead tap" bug).
export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  const allowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview" ||
    redesignUiEnabled();
  if (!allowed) notFound();
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">
        {children}
        <Toaster position="top-right" />
      </div>
    </ThemeProvider>
  );
}
