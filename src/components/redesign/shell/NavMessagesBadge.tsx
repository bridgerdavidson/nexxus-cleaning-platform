/**
 * Unread-count badge for the operator Messages nav item, sitting on the top-right
 * of the icon in both the desktop rail and the mobile bottom bar. Same visual
 * language as the cleaner/homeowner bottom-nav badges (brand pill, card-colored
 * ring, tabular count capped at 99+). Renders nothing when the count is zero.
 *
 * Must live inside a `relative` icon wrapper. Includes an sr-only count so the
 * link's accessible name announces the unread total.
 */
export function NavMessagesBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <>
      <span
        aria-hidden
        className="absolute -right-2 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-brand-600 px-1 text-[10px] font-bold leading-none tabular-nums text-white"
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">{count} unread</span>
    </>
  );
}
