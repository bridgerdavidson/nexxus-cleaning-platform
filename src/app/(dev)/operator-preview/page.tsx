import { OperatorShell } from "@/components/redesign/shell/OperatorShell";

// TEMPORARY dev-only preview for redesign fidelity iteration (gated by the (dev)
// layout). Overview content is swapped in during Task 5; removed at Task 6 cutover
// to the real /app/admin-dashboard page.
export default function OperatorPreviewPage() {
  return (
    <OperatorShell active="overview">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operator shell preview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Temporary dev preview for shell fidelity. Overview content lands in Task 5.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-card border border-border bg-card p-5 shadow-soft-sm" />
          ))}
        </div>
      </div>
    </OperatorShell>
  );
}
