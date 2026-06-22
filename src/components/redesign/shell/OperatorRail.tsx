"use client";

import Image from "next/image";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { OPERATOR_NAV } from "./nav-items";

/**
 * Desktop-only full-height brand rail. Collapsed to 64px showing the Nexxus
 * mark + icons; expands to 248px on hover to reveal the wordmark + labels.
 * One clean surface (no divider between brand and nav). Settings pinned bottom.
 */
export function OperatorRail({ activeId }: { activeId?: string }) {
  return (
    <aside
      className={cn(
        "group fixed inset-y-0 left-0 z-40 hidden w-16 flex-col overflow-hidden",
        "border-r border-border bg-card transition-[width,box-shadow] duration-200 ease-out",
        "hover:w-[248px] hover:shadow-soft-lg lg:flex"
      )}
    >
      {/*
        brand — ONE lockup image: the icon is its left portion and is always
        visible; the wordmark is clipped by the inner wrapper until the rail is
        hovered, when the wrapper widens to "reveal" the wordmark in place. The
        icon never moves or resizes (no crossfade, no swap). Theme via CSS dark:
        so it's SSR-correct with no flash.
      */}
      <div className="flex h-16 flex-none items-center pl-[13px]">
        <div className="h-8 w-10 overflow-hidden transition-[width] duration-200 ease-out group-hover:w-[150px]">
          {/* light theme: dark wordmark */}
          <Image
            src="/brand/logo-black.svg"
            alt="Nexxus"
            width={567}
            height={126}
            priority
            className="h-8 w-auto max-w-none dark:hidden"
          />
          {/* dark theme: white wordmark */}
          <Image
            src="/brand/logo-white.svg"
            alt="Nexxus"
            width={565}
            height={126}
            className="hidden h-8 w-auto max-w-none dark:block"
          />
        </div>
      </div>

      {/* nav */}
      <nav className="flex flex-1 flex-col gap-1 px-3 pb-3">
        {OPERATOR_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={cn(
                    "flex items-center gap-[13px] rounded-control px-[10px] py-[9px] text-muted-foreground transition-colors",
                    "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    item.id === "settings" && "mt-auto",
                    active && "bg-brand-600 text-white hover:bg-brand-600 hover:text-white"
                  )}
                >
                  <Icon className="h-6 w-6 flex-none" aria-hidden />
                  <span className="whitespace-nowrap text-[13px] font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    {item.label}
                  </span>
                </Link>
              </TooltipTrigger>
              {/* Tooltip only useful while collapsed; harmless when expanded */}
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
