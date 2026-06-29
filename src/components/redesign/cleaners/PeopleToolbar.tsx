"use client";

import type { ReactNode } from "react";
import { Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PeopleSegmentTabs } from "./PeopleSegmentTabs";
import type { PeopleSegment } from "./staff-types";

/**
 * Shared toolbar for the People screen so the Cleaners and Staff segments render
 * an IDENTICAL title / create / search / filter bar (only the labels, search
 * placeholder, and sort options differ between segments). Layout is three rows:
 *   [ title ............ create button ]
 *   [ search (full on mobile, capped on desktop) ]
 *   [ segment  |  sort (fills to the right margin)  |  trailing ]
 * The sort fills the remaining width on mobile so there is no dead space next to
 * the segment toggle; on desktop it caps so it does not become a giant control.
 */
export function PeopleToolbar({
  title,
  createLabel,
  onCreate,
  showCreate,
  search,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  segment,
  onSegmentChange,
  showSegmentTabs,
  sort,
  trailing,
}: {
  title: string;
  createLabel: string;
  onCreate?: () => void;
  showCreate: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  segment: PeopleSegment;
  onSegmentChange: (v: PeopleSegment) => void;
  showSegmentTabs: boolean;
  /** The segment's sort control. Its SelectTrigger should be `w-full` so it fills. */
  sort: ReactNode;
  /** Optional extra control (e.g. the Cleaners "Show benched" toggle). */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {showCreate ? (
          <Button onClick={onCreate} className="shrink-0">
            <Plus /> {createLabel}
          </Button>
        ) : null}
      </div>

      <div className="relative w-full sm:max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-10"
          aria-label={searchAriaLabel}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showSegmentTabs ? <PeopleSegmentTabs value={segment} onChange={onSegmentChange} /> : null}
        <div className="min-w-0 flex-1 sm:max-w-[12rem]">{sort}</div>
        {trailing}
      </div>
    </div>
  );
}
