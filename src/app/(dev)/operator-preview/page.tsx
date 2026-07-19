import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorOverviewView } from "@/components/redesign/overview/OperatorOverviewView";
import { getGreeting } from "@/components/redesign/overview/overview-types";

// TEMPORARY dev-only preview for redesign fidelity iteration (gated by the (dev)
// layout). Feeds the presentational Overview View mock data so it renders without
// auth/hooks. Removed at Task 6 when the real /admin page wires the
// hook-backed OperatorOverview.
export default function OperatorPreviewPage() {
  const { greeting, dateLabel } = getGreeting("Sarah", new Date());
  return (
    <OperatorShell active="overview">
      <OperatorOverviewView
        greeting={greeting}
        dateLabel={dateLabel}
        kpis={{
          todayJobs: 8,
          inProgress: 2,
          awaitingApproval: 4,
          revenueThisMonth: 12845,
          canViewPayments: true,
        }}
        unassigned={[
          { id: "u1", title: "Maple Ave · Deep clean", subtitle: "Thu Jun 25 · 10:30am" },
          { id: "u2", title: "Oak St · Standard clean", subtitle: "Fri Jun 26 · 1:00pm" },
        ]}
        declined={[{ id: "d1", title: "Birch Ln · Move-out clean", subtitle: "Sat Jun 27 · 9:00am · 3 cleaners declined" }]}
        counterProposed={[{ id: "c1", title: "Cedar Ct · Standard clean", subtitle: "Marco proposed Mon Jun 23 · 2:00pm" }]}
        overdue={[{ id: "o1", title: "Willow Way · Deep clean", subtitle: "Thu Jun 26 · 10:00am · Dana has not responded" }]}
        failedPayment={[{ id: "f1", title: "Aspen Rd · Deep clean", subtitle: "Wed Jun 24 · Card declined" }]}
        paymentsHref="/admin/payments"
        todayItems={[
          { id: "t1", time: "8:00am", title: "Pine St · Standard clean", subtitle: "Marco D.", status: "done" },
          { id: "t2", time: "10:30am", title: "Elm Ave · Deep clean", subtitle: "Sara K.", status: "live", elapsed: "1 hr 7 min" },
          { id: "t3", time: "11:15am", title: "Birch Ln · Standard clean", subtitle: "Marco D.", status: "live", elapsed: "27 min" },
          { id: "t4", time: "1:00pm", title: "Maple Ave · Standard clean", subtitle: "No cleaner yet", status: "unassigned" },
          { id: "t5", time: "3:30pm", title: "Oak St · Move-in clean", subtitle: "Priya R.", status: "upcoming" },
        ]}
      />
    </OperatorShell>
  );
}
