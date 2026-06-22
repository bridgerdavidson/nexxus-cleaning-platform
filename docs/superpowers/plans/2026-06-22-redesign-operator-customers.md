# Operator Customers screen (redesign, flag-gated)

Next operator screen after Overview (#79) and Bookings (#80). Mirrors the Bookings
Container/View split file-for-file into `src/components/redesign/customers/`, reusing
the existing headless data layer unchanged.

## Data (reused, no backend change)
- `useAdminCustomers()` -> `{ customers: AdminCustomer[], loading, refetch, updateCustomerInState }`
  (RPC `org_customers_with_counts` + legacy fallback; realtime piggybacks on the
  appointments + properties channels).
- `useCustomerDetails(detailId)` -> `{ appointments, properties, loading }` (lazy, `enabled: !!id`).
- Mutations: `updateCustomer(id, {first_name,last_name,email,phone})`,
  `deleteCustomer(id, orgId)` / `deleteCustomers(ids, orgId)` (server route; per-id
  `deleted|blocked|error`), `inviteTeamMember({email, role:'homeowner', organizationId, accessToken})`.

## Differences from Bookings
- **No time segments.** Customers have no lifecycle, so the list is a flat,
  searchable, sortable table (sort: Newest / Name A-Z / Top spenders). No Tabs.
- **Detail data is two-hook**: profile from the list row + properties/history lazily
  from `useCustomerDetails(detailId)`. Sheet shows a loading state for the lazy part.
- **Bulk = Delete only** (`deleteCustomers`, per-id deleted/blocked/error -> own toast summary).
- **Inline edit** in the sheet (first/last/email/phone -> `updateCustomer` + `updateCustomerInState`).
- **New customer = invite** (native dialog, email-only per the API contract; invitee
  appears once they accept).
- Gating: `canViewPayments` (spend column + Revenue KPI + history prices),
  `canEdit = privileged || can_edit_customers` (new/edit/delete/select). RLS + action
  gating instead of a separate access-denied screen (Bookings parity).

## Files
- `customers-types.ts`, `deriveCustomers.ts` (+ `.test.ts`), `customers-presenters.tsx`
- `CustomersTable.tsx`, `CustomersCardList.tsx`, `CustomersBulkBar.tsx`, `AddCustomerDialog.tsx`
- `CustomerDetailSheet.tsx`, `OperatorCustomersView.tsx`, `OperatorCustomers.tsx`
- `src/app/(redesign)/app/admin-dashboard/customers/page.tsx` (active="people")
- `src/app/(dev)/customers-preview/page.tsx`
- `nav-items.ts`: repoint the `people` item href to `/app/admin-dashboard/customers`.

## Gates before push
`npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, Playwright visual check via the
dev preview, Codex review.
