import { Loader2 } from "lucide-react";

/**
 * Content-area loading state for dashboard screens. Sized to the content
 * column rather than the viewport so the shell chrome (top bar, rail, bottom
 * nav) stays put while a tab's content streams in. Used by the route-level
 * loading.tsx boundaries and by per-page permission checks.
 */
export function ContentLoading() {
  return (
    <div role="status" className="grid min-h-[50dvh] place-items-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-ink" aria-hidden />
      <span className="sr-only">Loading</span>
    </div>
  );
}
