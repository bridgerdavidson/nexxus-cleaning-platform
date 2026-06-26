"use client";

import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/** Native settings row: label + helper on the left, control on the right, hairline divider. */
export function SettingRow({
  label, htmlFor, helper, children,
}: { label: string; htmlFor?: string; helper?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-5 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="space-y-1 sm:max-w-sm">
        <Label htmlFor={htmlFor} className="text-foreground">{label}</Label>
        {helper ? <p className="text-sm text-muted-foreground">{helper}</p> : null}
      </div>
      <div className="shrink-0 sm:pt-0.5">{children}</div>
    </div>
  );
}

export function SectionHeader({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
    </div>
  );
}

export function SectionSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
