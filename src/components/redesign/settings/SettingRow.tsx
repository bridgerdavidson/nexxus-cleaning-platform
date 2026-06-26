"use client";

import { Label } from "@/components/ui/label";

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
