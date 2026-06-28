"use client";

import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

const ROW_CLASS =
  "flex w-full items-center gap-3 rounded-card border border-border bg-card p-3.5 text-left shadow-soft-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring";

/** A tappable settings-style row (icon + title + optional subtitle + chevron).
 *  Renders as a Link when `href` is set, otherwise a button. */
export function ProfileRow({
  icon: Icon,
  title,
  subtitle,
  href,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-foreground">{title}</span>
        {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );

  if (href) {
    return (
      <Link href={href} className={ROW_CLASS}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={ROW_CLASS}>
      {inner}
    </button>
  );
}
