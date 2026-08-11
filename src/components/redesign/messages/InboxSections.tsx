/**
 * Section chrome for the sectioned (cleaner/homeowner) inboxes (D12):
 * SectionHeader is the one page-section header; ListShell is the flush
 * full-bleed list container the rows sit in (D1).
 */
export function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-0.5">
      <h2 className="text-sm font-bold">{label}</h2>
      {count !== undefined && (
        <span className="ml-auto text-xs font-medium text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

export function ListShell({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-hidden border-y border-border/60 bg-card">{children}</div>;
}
