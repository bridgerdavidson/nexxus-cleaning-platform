"use client";

import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { OPERATOR_NAV } from "./nav-items";

/**
 * Desktop-only full-height brand rail. Collapsed to 56px showing the Nexxus
 * mark + icons; expands to 220px on hover to reveal the wordmark + labels.
 * One clean surface (no divider between brand and nav). Settings pinned bottom.
 */
export function OperatorRail({ activeId }: { activeId?: string }) {
  return (
    <aside
      className={cn(
        "group fixed inset-y-0 left-0 z-40 hidden w-[56px] flex-col overflow-hidden",
        "border-r border-border bg-card transition-[width,box-shadow] duration-200 ease-out",
        "hover:w-[220px] hover:shadow-soft-lg lg:flex"
      )}
    >
      {/* brand */}
      <div className="flex h-[56px] flex-none items-center gap-3 px-[14px]">
        <span className="relative h-8 w-8 flex-none rounded-control bg-brand-600">
          <span
            aria-hidden
            className="absolute inset-[8px] rounded-[4px] bg-white/90"
            style={{ clipPath: "polygon(0 0,55% 0,100% 100%,45% 100%)" }}
          />
        </span>
        <span className="whitespace-nowrap text-lg font-extrabold tracking-tight text-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          Nexxus
        </span>
      </div>

      {/* nav */}
      <nav className="flex flex-1 flex-col gap-1 px-2 pb-3">
        {OPERATOR_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-[13px] rounded-control px-[9px] py-[9px] text-muted-foreground transition-colors",
                    "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    item.id === "settings" && "mt-auto",
                    active && "bg-brand-600 text-white hover:bg-brand-600 hover:text-white"
                  )}
                >
                  <Icon className="h-5 w-5 flex-none" aria-hidden />
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
