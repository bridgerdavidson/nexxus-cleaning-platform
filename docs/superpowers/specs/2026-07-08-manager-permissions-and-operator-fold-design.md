# Manager Permissions Overhaul + Operator Fold-in — Design

`Date: 2026-07-08 · Status: Approved (brainstorming), ready for implementation plan`

## Context

The **manager** role is the one role the design-system redesign never covered, and its permission model is inconsistent and partly unenforced (the "half-assed manager permissions"). This spec was reconstructed on 2026-07-08 by crawling the code and redesign docs; **no prior manager spec existed** in git, stash, or scratchpad, so the model below is derived fresh from the current code plus the redesign's committed decisions.

Two role systems coexist (see `CLAUDE.md`): `UserRole` on `user_profiles.role` and `OrgRole` on `organization_members.role`. The redesign made a load-bearing decision that frames this work: **admin + manager are one permissioned "Operator" experience, not two designs** (`docs/redesign/2026-06-19-dashboard-functional-inventory.md:228`). So "build out the manager dashboard" means folding managers into the already-built redesigned Operator console (`/app/admin-dashboard`), not designing a separate screen.

### The problems this spec fixes (current state)

1. **Enforcement is bypassed structurally.** Every API route uses the service-role client (`supabaseAdmin`), which bypasses RLS, so the org+flag RLS policies (migrations 074/075) are dead for all API traffic. Enforcement falls to whatever ad-hoc `role` check each route happens to have.
2. **Payment routes ignore the flags.** `invoices/create` and `payments/record` (and others) admit any manager on role alone with no `can_manage_payments` check. A manager with every flag off can still create invoices, record payments, and charge cards.
3. **`can_edit_bookings` has zero API enforcement**; several booking-mutation routes skip it. `can_approve_decline_bookings` is only half-enforced and overlaps `can_handle_requests`.
4. **`can_edit_properties` is fully dead** (toggled, persisted, seeded, never read anywhere). `can_manage_services` is UI-only (RLS grants all managers full `service_types` CRUD).
5. **New managers are seeded near-omnipotent**: `accept-invite` sets 14/15 flags to `true`, contradicting the "all-false default" the DDL, the hook, and the docs all assume.
6. **No single source of truth**: the type lives in `useAdminData.ts` (not `src/types`); two hard-coded flag arrays; three `ALL_FALSE` literals; two parallel editors (`ManagerPermissionsForm` and the redesign `StaffDetailSheet`).
7. **Manager is dead-ended to legacy UI**: `dashboardPath.ts` pins manager to `/manager-dashboard` with no redesign branch; it is the only role still on the legacy dashboard.

Privilege escalation is already closed (managers cannot edit permissions or delete/invite admins, at both API and RLS layers); this spec preserves that.

## Reference docs

- Redesign direction: `docs/redesign/2026-06-19-redesign-decisions.md`, `docs/redesign/2026-06-19-dashboard-functional-inventory.md`, `docs/superpowers/specs/2026-06-19-dashboard-redesign-design.md`.
- Redesign conventions & primitives: `src/components/ui/*`, tokens in `tailwind.config.js` + `src/app/globals.css`, the `(redesign)` route group, `src/lib/redesign/*`.
- Reconstruction memory: `manager-dashboard-permissions-state` (in the project memory store).
- Companion mockups (structure/UX reference ONLY, not styling): `.superpowers/brainstorm/*/content/{nav-gating,kpi-tiles,invite-permissions}.html`.

## Goals

1. Every manager permission flag we keep is **actually enforced server-side**, closing the identified security gaps.
2. **One canonical source of truth** for the flag set (a registry), consumed everywhere.
3. A **coherent default posture**: the invite carries the manager's permissions (defaulting to a safe preset); no hardcoded all-true/all-false server seed.
4. **Fold managers into the redesigned Operator console**: routing + permission-gated states (filtered nav, route guards, stripped-down Overview, per-permission KPI strip).

## Non-goals

- No separate/standalone manager dashboard or screen. Manager = permission layer over the Operator (admin) design.
- No deletion of the legacy `src/app/manager-dashboard/page.tsx` — that belongs to the global redesign cutover. Legacy stays functional with the redesign flag off.
- No "Access Denied" card UI — forbidden routes silently redirect to Overview.
- No rework of admin's own behavior beyond what folding managers in requires.
- No change to the payment/Stripe architecture; this only adds authorization checks in front of existing routes.

## Part A — One permission model (single source of truth)

- **New registry** `src/lib/permissions/managerFlags.ts`: a single ordered array of flag definitions `{ key, label, description, group, enforce }` where `enforce` records the enforcement mechanism (`'route' | 'rls' | 'rpc' | 'ui'`). Export a derived `ManagerPermissions` type and the `STANDARD_MANAGER_PRESET`. Re-export the type from `src/types`.
- **Retire the duplication**: remove the `ManagerPermissions` interface from `useAdminData.ts`, the second hard-coded flag array, and the three `ALL_FALSE`/`NONE` literals — all derive from the registry. `useManagerPermissions` builds its default from the registry.
- **14 flags (was 15):** merge `can_approve_decline_bookings` into `can_handle_requests` (single "Handle requests" flag covering approve/decline + assign/reassign). Keep `can_edit_properties` (now enforced).
- **Flag groups** (for the editor UI): Bookings (`can_view_bookings`, `can_edit_bookings`, `can_handle_requests`); Customers (`can_view_customers`, `can_edit_customers`); Properties (`can_view_properties`, `can_edit_properties`); Services (`can_view_services`, `can_manage_services`); Payments & payouts (`can_view_payments`, `can_manage_payments`); Insight & comms (`can_view_analytics`, `can_view_messages`); Cleaners & team (`can_manage_cleaners`).
- **One editor component**, registry-driven, reused by both the invite form and Settings → Team. `ManagerPermissionsForm` and the redesign `StaffDetailSheet` toggle list both render from the registry so they can never drift.

## Part B — Enforcement (the fix)

- **New shared guard `requireManagerPermission(request, orgId, flag)`** in `src/lib/auth/`, generalizing `requireOrgPaymentsAuth`: owner/admin always pass; a manager passes iff the flag is `true` on their `manager_permissions` row; otherwise `403`. Returns the same `{ ok, response }` shape as `requireOrgAuth`.
- **Add the guard to every route that today admits managers on role alone**, each declaring its governing flag:
  - `can_manage_payments`: `api/invoices/create`, `api/payments/record`, `api/stripe/create-payment-intent`, `api/billing/card-links`, and the **non-self-pay** branch of `api/appointments/[appointmentId]/charge`.
  - `can_edit_bookings`: `api/recurring-appointments` (POST), `api/appointments/[appointmentId]/cancel`, `api/appointments/[appointmentId]/lifecycle`, `api/appointments/notify-reschedule`.
  - `can_handle_requests`: `api/appointments/accept-counter-proposal` (aligning it with `assign-cleaner`/`reassign-cleaner`, which already gate on it).
  - The exact route list is confirmed against the code during planning; the audit in the reconstruction is the starting inventory.
- **Multi-role routes:** several of these routes (`cancel`, `lifecycle`, `notify-reschedule`) also serve homeowner and/or cleaner callers. The manager-permission check applies **only to the manager branch** — it must not block the other allowed roles, which keep their existing checks. `requireManagerPermission` is layered onto the manager case, not swapped in for the whole route's role gate.
- **Direct-client tables (services, properties)** have no API route, so the guard cannot reach them. Enforce via **RLS**: add `can_manage_services` to `service_types` write policies and `can_edit_properties` to `properties` write policies. This is how "wire it" is realized for those two flags.
- **PII reads:** add an explicit `can_view_*` check to service-role read/list routes that return homeowner PII (e.g. `api/recurring-appointments` GET returns addresses). Non-PII lists (services) remain UI-gated.
- **Defense-in-depth:** RLS stays as a backstop everywhere. The core `appointments` table remains flag-blind at RLS (covered by the route guard); tightening its RLS is optional follow-up, not required for correctness.

### Enforcement matrix

| Flag | Primary enforcement |
|---|---|
| `can_manage_payments`, `can_edit_bookings`, `can_handle_requests` | `requireManagerPermission` guard on the listed API routes |
| `can_manage_services`, `can_edit_properties` | RLS predicate on direct-client writes |
| `can_view_payments` | analytics RPC nulls money (existing) + guard on payment read routes |
| `can_view_bookings` / `can_view_customers` / `can_view_properties` (PII) | explicit check on PII read routes; UI gate elsewhere |
| `can_view_services`, `can_view_messages`, `can_view_analytics` | existing RPC/UI gates, verified against the registry |
| `can_manage_cleaners` | existing route guards (`delete-cleaner`, `send-invite`, etc.), verified against the registry |

## Part C — Default posture

- **No hardcoded server default.** Delete the 14-true seeding block in `api/accept-invite/route.ts`. The **invite carries the flag set**: `api/admin/send-invite` accepts a `permissions` object (validated against the registry) and stores it on the invite; `accept-invite` persists exactly that into `manager_permissions`.
- The invite form defaults to the **"Standard manager" preset** from the registry: `can_view_bookings`, `can_edit_bookings`, `can_handle_requests`, `can_view_customers`, `can_edit_customers`, `can_view_properties`, `can_view_services`, `can_view_analytics`, `can_view_messages` **on**; `can_edit_properties`, `can_manage_services`, `can_view_payments`, `can_manage_payments`, `can_manage_cleaners` **off**.
- The permission control renders **collapsed** ("Using the Standard manager preset · Customize") and expands to the full grouped editor, so the invite form stays compact. If never expanded, the preset is sent.

## Part D — Operator fold-in (UI)

All states below were validated in the browser companion; the mockups are UX/structure reference only.

- **Routing:** `src/lib/redesign/dashboardPath.ts` routes `manager` → `/app/admin-dashboard` when the redesign flag is on (mirroring admin). Update `dashboardPath.test.ts`, which currently asserts manager stays on legacy.
- **Navigation:** filter `OPERATOR_NAV` (desktop rail + mobile primary bar + drawer) by the manager's permissions — **inaccessible destinations are hidden** (not shown-disabled). Admin (privileged) sees all.
- **Route guard:** every `/app/admin-dashboard/*` route checks its governing flag for managers; a manager without it is **silently redirected to Overview** (no denied-card UI). This is UX only — the data is already protected by Part B.
- **Overview:** a **stripped-down manager hero** (greeting + today summary + `can_edit_bookings`-gated "New booking" CTA; no owner setup checklist, no company-wide revenue banner). The **KPI strip** is composed of registry-gated tiles; tiles whose permission is missing are **dropped and the grid reflows** (this replaces the ad-hoc revenue→"Unassigned" fallback). Operational tiles keep the strip populated.
- **Redesigned Operator screens** (`bookings`, `customers`, `cleaners`, `services`, `payments`, `analytics`, `messages`, `settings`) already consume `useManagerPermissions`; this work audits each against the registry so component-level actions (edit/create/approve) are gated correctly, and wires the Settings → Team editor to the canonical editor component.
- **Legacy path unchanged:** with the redesign flag off, managers still get `/manager-dashboard`; both paths keep working until the global cutover.

## Part E — Migrations & data

- **Flag merge migration:** set `can_handle_requests = can_handle_requests OR can_approve_decline_bookings` on existing `manager_permissions` rows, update any RLS/policy referencing `can_approve_decline_bookings`, then retire that column.
- **RLS enforcement migration:** add the `can_manage_services` predicate to `service_types` write policies and the `can_edit_properties` predicate to `properties` write policies (mirroring the org+flag pattern already used for invoices/payouts in 075).
- **Invite permissions:** add storage for the invite's `permissions` payload (column/JSON on the invite row) so `accept-invite` can read it.
- Migrations are additive and use `IF EXISTS` / `IF NOT EXISTS` guards; verified with `npx supabase db reset` before push.

## Part F — Testing (per the create-tests skill)

- **Integration tests** (co-located `*.integration.test.ts`, using `tests/helpers/`) for `requireManagerPermission` on each newly-guarded route: 401 (unauth), 403 (manager without the flag), 200 (manager with the flag), 200 (admin). Priority: `invoices/create`, `payments/record`, `create-payment-intent`, non-self-pay `charge`, `recurring-appointments` POST, `accept-counter-proposal`, `cancel`, `lifecycle`.
- **RLS integration tests** for services/properties: a manager without `can_manage_services` / `can_edit_properties` is denied the direct-client write; with the flag, allowed.
- **Unit tests** for the registry (shape, no dupes) and the `STANDARD_MANAGER_PRESET` contents.
- Update the existing `update-manager-permissions` integration test and any test referencing `can_approve_decline_bookings` for the merged flag.
- **Invite flow**: test that `send-invite` stores the permissions payload and `accept-invite` persists it (and defaults to the preset when omitted).

## UI implementation & styling source (contract)

The browser-companion mockups referenced here are **UX/structure reference ONLY**. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). **Do not** copy ad-hoc colors, raw hex, or bespoke classes from a mockup. If a needed pattern has no primitive yet, build it as a reusable primitive that matches the system, never an inline one-off. Run `ui-ux-pro-max` at implementation time to catch off-system styling.

## Verification / acceptance criteria

- A manager with all flags off receives `403` from every guarded API route and cannot write to `service_types`/`properties` directly; with the flag, the action succeeds.
- A newly invited manager has exactly the permissions chosen at invite time (preset if untouched) — not all-true.
- `can_edit_properties` and `can_manage_services` are enforced (no longer dead/UI-only); `can_approve_decline_bookings` no longer exists.
- With the redesign flag on, a manager lands on `/app/admin-dashboard`, sees only permitted nav destinations, is redirected to Overview on a forbidden direct URL, and sees a KPI strip with only tiles they can access.
- One registry is the sole definition of the flag set; no duplicate arrays/types remain.
- `npm run test`, `npx tsc --noEmit`, `npm run lint` pass; `npx supabase db reset` rebuilds cleanly.

## Open confirm-at-implementation items

- **Preset — View payments default:** off (owner opts in). Confirmed in design; revisit only if it causes friction.
- **`appointments` RLS tightening:** left as optional defense-in-depth; the route guard is the primary control.
- **Exact guarded-route list:** the Part B inventory is the audit's starting point; confirm each route against current code during planning (some may have gained checks since the audit).

## Risks

- **Missed route.** A sensitive route without the guard stays open. Mitigation: the registry + a checklist of mutation routes in the plan, plus integration tests per route.
- **Direct-client vs guard split.** Two enforcement mechanisms (guard for API, RLS for services/properties) must both be right. Mitigation: RLS integration tests, and RLS stays as defense-in-depth behind the guard.
- **Flag-merge data migration.** Existing rows must OR the two request flags before the column is dropped. Mitigation: single migration does OR-then-drop; tested via `db reset` + integration tests.
- **Routing flip regressions.** Sending managers to `/app/admin-dashboard` exposes any incomplete permission-gating on the shared Operator screens. Mitigation: per-screen audit against the registry is in scope (Part D).
```
