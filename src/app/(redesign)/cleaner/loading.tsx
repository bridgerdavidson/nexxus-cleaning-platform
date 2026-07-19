import { ContentLoading } from "@/components/redesign/shared/ContentLoading";

// Route-level loading boundary: lets Next.js commit a tab navigation
// immediately (and partially prefetch the route) instead of blocking the tap
// on a server round trip. Renders inside the persistent shell from layout.tsx,
// so only the content area shows this while the page streams in.
export default function Loading() {
  return <ContentLoading />;
}
