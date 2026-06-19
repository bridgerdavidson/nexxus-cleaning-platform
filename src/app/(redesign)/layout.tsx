// src/app/(redesign)/layout.tsx
import { notFound } from "next/navigation";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { redesignUiEnabled } from "@/lib/redesign/flags";

// Redesign screens are reachable in local dev, on Vercel preview, OR in any
// environment where NEXT_PUBLIC_REDESIGN_ENABLED === "true". With the flag off
// in production the tree 404s, so in-progress screens never leak. Per-request
// (force-dynamic) so the runtime env is authoritative.
export const dynamic = "force-dynamic";

export default function RedesignLayout({ children }: { children: React.ReactNode }) {
  const allowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview" ||
    redesignUiEnabled();
  if (!allowed) notFound();
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="redesign font-jakarta min-h-screen">{children}</div>
    </ThemeProvider>
  );
}
