# R4 — Operator Properties workspace (design spec)

**Date:** 2026-07-11
**Audit item:** R4 in `docs/redesign/2026-07-09-functionality-audit.md` (§3)
**Status:** design approved via browser companion (2026-07-11); ready for implementation plan.

## 1. Context & goal

The redesigned operator console has no Properties destination. Properties are read-only inside `CustomerDetailSheet`, and there is no way for an operator to create, edit, delete, photograph, add instructions to, assign a homeowner to, or book from a property in the redesign. Consequences today: a redesign-only org cannot take a phone booking for a new address, cannot book for a customer with zero properties, and self-pay/org-owned properties have no home at all. Legacy `PropertiesPage` still covers this but breaks at cutover.

R4 builds the operator Properties workspace: a top-level list + a right-side detail/edit/create sheet + a safe delete model + two booking-flow wires (book-from-property, inline add-property). It is **operator-only**; the homeowner's own property surfaces are untouched (we only lift shared logic and add an archived-row read filter).

## 2. UI implementation & styling source (contract — read before building any screen)

The browser-companion mockups produced during design (`.superpowers/brainstorm/21338-*/content/*.html`) are **UX/structure reference ONLY**. Every screen is implemented from our design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale, semantic tokens like `rounded-card`, `shadow-soft-md`, `bg-critical-50`, `text-critical-700`). **Do not copy ad-hoc colors, raw hex, or bespoke classes from a mockup** (the mockups' warm-beige/blue inline styles are throwaway). Status and urgency use the existing badge/pill vocabulary, not decorative side-accents. If a needed pattern has no primitive yet, build it as a reusable primitive matching the system, never an inline one-off. `ui-ux-pro-max` runs again at implementation time as the design-system conformance catch-net.

## 3. Scope

**In scope**
- Top-level **Properties** nav destination + route, gated `can_view_properties`.
- Properties **list** (dense table, same kit as Customers/Bookings) with search + owner filter.
- Shell-level **`?property=` detail host** and a **read/edit/create sheet** (photo, name, address, details, homeowner assign/change/remove, special + access instructions).
- Safe **delete model** (cancel upcoming + preserve history via archive; hard-delete never-booked).
- **Book from property** (seed the new-booking sheet) and **inline add-property** in the zero-property booking picker.
- `CustomerDetailSheet` property cards **deep-link** into the workspace (`?property=`).
- Two small **migrations** (archived flag; realtime publication) and a **`Property` type** extension.

**Out of scope / non-goals**
- Homeowner-side property management (leave `redesign/homeowner/account/properties/*` UI as-is; only extract shared logic + add the archived read filter).
- Multi-photo galleries (single hero `photo_url` only — matches the schema).
- An un-archive / archived-properties view (fast-follow; see §12).
- Bulk delete (single-row delete only for R4; see §12).
- Half-bathrooms (schema `bathrooms` is `integer`; keep whole numbers).
- New `/api/properties/**` route layer — writes stay client-direct (RLS is the boundary; see §5).

## 4. Data model & schema changes

**`properties` table** (`supabase/migrations/000_baseline.sql:1202-1219`) — exact columns:
`id`, `owner_id` (uuid, **nullable** since `077_org_self_pay.sql`; **NULL = org-owned / self-pay**), `name` (text, NOT NULL), `address`, `city`, `state`, `zip_code` (all text NOT NULL), `bedrooms` `bathrooms` `square_feet` (integer, nullable), `special_instructions`, `access_instructions` (text, nullable), `created_at`, `updated_at`, `organization_id` (uuid, NOT NULL), `photo_url` (text, nullable). Bucket `property-photos`; path `properties/<propertyId>/<uuid>.jpg`.

**Relationships (delete-relevant):** `appointments.property_id` → `properties(id)` **ON DELETE CASCADE** (NOT NULL); `recurring_appointment_series.property_id` → `properties(id)` **ON DELETE CASCADE**. So a hard `DELETE` of a property wipes all its appointments + series — which is exactly what the archive model exists to avoid for properties with history.

### 4.1 Migration (one file, guarded)

1. **Archived flag:** `ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS archived_at timestamptz;` (`NULL` = active). No backfill needed. This is the soft-delete marker.
2. **Realtime publication:** `ALTER PUBLICATION supabase_realtime ADD TABLE public.properties;` guarded exactly like `081_realtime_enable.sql` (properties has `REPLICA IDENTITY FULL` already but was never added to the publication, so the existing `properties:${orgId}` subscription doesn't fire today). Wrap in the same `DO $$ ... IF NOT EXISTS in pg_publication_tables ... $$` guard as 081 so re-runs are safe.

No RLS change is required (see §5).

### 4.2 TypeScript type

Extend the canonical `Property` shape with `photo_url: string | null` (currently missing per `src/types/index.ts:146-162`) and `archived_at: string | null`, centrally, so R4 doesn't cast. Reconcile with the `AdminProperty` shape used by `useAdminProperties` and the `Property` type in `@/hooks/useHomeownerData` (the form sheet imports the latter). Pick one source of truth for the operator path and note the reconciliation in the plan.

## 5. Permissions

**No new plumbing.** All property writes go through the **direct anon client** gated by Postgres RLS. `104_manager_flags_rls_services_properties.sql` already gates `properties` insert/update/delete on `mp.can_edit_properties = true` for the manager role (owner/admin bypass), proven by `src/app/api/_rls/manager-services-properties-rls.integration.test.ts`. Rules R4 must not break:

- **Keep writes client-direct.** Do **not** add a service-role property-write route (bypasses RLS). If a route ever becomes necessary, put `requireManagerPermission(request, orgId, supabaseAdmin, 'can_edit_properties')` at its top.
- **Nav + page** gated on `can_view_properties` (`requires` on the nav item + `useRequireManagerFlag('can_view_properties')` on the page). `can_view_properties` is already in `STANDARD_MANAGER_PRESET`.
- **Create/edit/delete/assign affordances** cosmetically gated on `can_edit_properties` (hide/disable); RLS is the real boundary.
- **Archive UPDATE** (`archived_at`) is a `properties` UPDATE → already covered by the `properties_update` policy (can_edit_properties).
- **Cross-permission interaction (important):** the delete flow's "cancel upcoming cleanings" step is an `appointments` UPDATE, gated by `can_edit_bookings` RLS (migration 106). Therefore deleting a property **that has live cleanings** requires **both** `can_edit_properties` **and** `can_edit_bookings`. Make this explicit in the UI: a manager with `can_edit_properties` but not `can_edit_bookings` can still hard-delete never-booked properties and archive history-only properties, but the "delete with N upcoming cleanings" override is disabled for them with a clear message ("Removing the upcoming cleanings needs booking-edit permission"). Do not let it fail opaquely at RLS.

## 6. Architecture & components

Mirror the established booking-host pattern (`OperatorBookingDetailHost` / `?booking=`, PR #138) and the `CustomerDetailSheet` read→edit contract.

| Piece | Path (new unless noted) | Responsibility |
|---|---|---|
| Nav item | `src/components/redesign/shell/nav-items.ts` (edit) | Add `{ id:'properties', label:'Properties', href:'/app/admin-dashboard/properties', icon: Building2, requires:'can_view_properties' }` (non-primary → rail + mobile "More", like Calendar). Update `nav-items.test.ts` snapshot. |
| Route | `src/app/(redesign)/app/admin-dashboard/properties/page.tsx` | Copy `calendar/page.tsx`; `useRequireManagerFlag('can_view_properties')`, `active="properties"`, renders `<OperatorProperties/>`. |
| Detail host | `OperatorPropertyDetailHost` mounted in `OperatorShell` (gated `can_view_properties`) | Owns `?property=<id>`; renders `PropertyDetailSheet` in place on **any** operator page (so the Customers-sheet deep-link opens without navigating away). Single param owner, exactly like the booking host. |
| List | `src/components/redesign/properties/OperatorProperties.tsx` | Table + `ListFilterBar` + empty/skeleton/error. Row click sets `?property=`; row menu = Book / Edit / Delete. "Add property" button. |
| Detail sheet | `src/components/redesign/properties/PropertyDetailSheet.tsx` | Right-side `Sheet`, `canEdit/editing/onEditingChange/onSave→Promise<boolean>` contract (like `CustomerDetailSheet`). Read (shared `Field`) → edit/create (FormField). Houses the homeowner-assignment block, the photo field, and the footer actions. |
| Delete flow | `PropertyDeleteDialog` (in properties/) + a new data helper `archiveOrDeleteProperty()` in `useAdminData.ts` | The bucketed cancel-upcoming + archive-or-hard-delete logic (§7.4). Replaces the naive `deleteProperty` call for the operator. |
| Homeowner assign | reuse an existing homeowner/member picker or a small `HomeownerAssignField` | Search org members with `role='homeowner'`; set/clear `owner_id`. Behind the self-pay UI flag, like legacy. |
| Shared logic | promote `validateProperty.ts`, `PropertyPhotoField.tsx`, and the payload/`fromProperty` mapping from `redesign/homeowner/account/properties/` into a shared location (e.g. `src/lib/properties/` + `src/components/redesign/properties/shared/`) | Both homeowner and operator import; no fork. `Field` comes from `bookings/detail-atoms.tsx` — import it, do not add a 7th copy. |
| Booking wires | `usePropertiesByOwner`, `OperatorBookingForm`, `OperatorBookingHost`, `operatorBookingParams`, `useOpenOperatorBooking` (edits) | Seed customer/property/billTo (§7.5) + inline add-property (§7.6). |
| Data | `useAdminProperties` (reuse; add archived filter) + new mutations | List hook already selects all fields + joins homeowner + subscribes `properties:${orgId}`. |

## 7. Behavior per surface

### 7.1 List (`OperatorProperties`)
- **Table**, same visual kit as `OperatorCustomers`/`OperatorBookings`. Columns: **Property** (thumbnail from `photo_url` with a placeholder when null + `name`), **Address** (`address`, `city`/`state`), **Homeowner** (`first_name last_name` from the joined homeowner, or an **`Org-owned`** badge when `owner_id` is null), **Details** (`bedrooms` bd · `bathrooms` ba · `square_feet` sf, tabular numerals, graceful when null), **row menu** (Book / Edit / Delete).
- **Filter bar** (`ListFilterBar`): text search over name + address; segmented filter **All / Homeowner / Org-owned**.
- Row click sets `?property=<id>` (opens the sheet via the shell host). Skeleton while loading; `ErrorState` with retry on failure; empty state ("No properties yet" + "Add property") — never a blank skeleton-forever.
- **Responsive:** table on desktop; collapses to a card list on mobile (`overflow-x-auto` is not enough for this many columns — switch to stacked cards under the mobile breakpoint).
- Reads exclude archived (`archived_at IS NULL`).

### 7.2 Detail sheet — read mode
Sections top→bottom: **hero photo** (or placeholder) → **name** + full address → **Homeowner** (avatar + name + email, or `Org-owned`) → **Details** (bd/ba/sqft) → **Special instructions** → **Access instructions**. Footer: **Book cleaning** (primary), **Edit** (secondary), **Delete** (quiet danger, separated). Read rows use the shared `Field`.

### 7.3 Detail sheet — edit & create
- Edit swaps rows for `FormField` + `Input`/`Textarea`: name*, address*, city*, state*, zip_code* (required — reuse `validateProperty`), bedrooms/bathrooms/square_feet (numeric, `toNumberOrNull`), special_instructions, access_instructions. Homeowner block gets **Change** / **Remove** (Remove → `owner_id=null` → Org-owned), behind the self-pay UI flag + `can_edit_properties`.
- **Save disabled until dirty** (no accidental no-op save; matches the R2/R3 precedent). Closing with unsaved edits → `DiscardChangesDialog`.
- **Create** = same sheet, empty form, opened from the list "Add property" (and from the booking inline-add, §7.6). Insert writes `owner_id` (selected homeowner or null) + `organization_id`. **The photo control appears only after the first save** (upload needs a property id) — mirror `PropertyFormSheet.tsx:151`; show a subtle "save first to add a photo" affordance in create mode.
- Edit uses `updateProperty(id, {...payload, photo_url})`; the homeowner-assignment write is an `owner_id` UPDATE (new; there is no reassign path in the redesign today).

### 7.4 Delete model (approved)
Compute two counts for the property (status vocabulary is `AppointmentStatus = pending|confirmed|in_progress|completed|cancelled`):
- **live** = appointments with status in **(pending, confirmed, in_progress)** — the "upcoming/blocking" set.
- **history** = appointments with status in **(completed, cancelled)** — must be preserved.

Behavior:
- **total === 0 (never booked):** hard `DELETE` the property (row removed). Standard confirm ("permanently removed, can't be undone").
- **total > 0 (has any record):** on confirm — **(a)** set every **live** appointment's status to `'cancelled'` (operator teardown, **no cancellation fee charged**) and stop/cancel any active recurring series for the property; **(b)** **archive** the property (`archived_at = now()`). All history (completed/cancelled, incl. the just-cancelled) is preserved because the row survives; the property vanishes from the workspace, pickers, and new-booking everywhere via the archived read filter.
  - **Warning card** (big, not a hard block): if `live > 0`, "This property has **N upcoming cleanings** that will be cancelled. Past & cancelled cleanings stay on record. The property is archived so history still resolves." If `live === 0` (history-only), drop the cancellation line ("Past cleanings stay on record; the property is archived").
  - **Permission gate (see §5):** if `live > 0` and the operator lacks `can_edit_bookings`, disable the override with the explanatory message; they can still archive history-only or hard-delete never-booked properties.
- New helper `archiveOrDeleteProperty(propertyId, orgId, { canEditBookings })` encapsulates the counts + cancel + archive/delete, returning enough for the dialog to render the right copy. Recurring-series stop mechanism (an `is_active`/status field on `recurring_appointment_series`) must be verified against that table's schema in the plan.

### 7.5 Book from property
Extend the operator new-booking seeding (currently date/time only, `useOpenOperatorBooking.ts:6-11`, `operatorBookingParams`, `OperatorBookingHost`, `OperatorBookingForm.tsx:61-76`) to also carry **`customerId`**, **`propertyId`**, and **`billTo`**. The property sheet's **Book cleaning** opens `?newbooking=` seeded with the property's owner (as customer) + the property + billTo. **Set `billTo` first** so the form's reset-on-billTo-flip effect (`OperatorBookingForm.tsx:194-214`) doesn't clobber the seeded customer/property. For an **org-owned** (null-owner) property, seed self-pay / `billTo=company` and no customer.

### 7.6 Inline add-property (zero-property customer)
In `OperatorBookingForm`'s property picker empty state (`OperatorBookingForm.tsx:228-237`), add **"+ Add a property"** that opens the create sheet pre-seeded with the current `customerId` as `owner_id`. On save: invalidate `usePropertiesByOwner` (key `['operator-booking','properties-by-owner',orgId,ownerId]`) and **auto-select** the new property in the picker. Removes the only hard dead-end in the booking flow.

### 7.7 CustomerDetailSheet deep-link
The read-only property cards (`CustomerDetailSheet.tsx:208-219`) get an affordance that sets `?property=<id>`; the shell host opens the property sheet **in place** over the Customers page (no navigation away). Thread the handler through the presenter props.

### 7.8 Archived read filter (cross-cutting)
Every property read must exclude archived rows (`archived_at IS NULL`): `useAdminProperties`, `useCustomerDetails` property select, `usePropertiesByOwner`, **and** the homeowner reads (`keys.properties.byHomeowner`, `HomeownerProperties`) so an archived property never resurfaces for the homeowner or in booking. This is the one place R4 touches homeowner code — a query filter, not the UI.

## 8. Reuse inventory (lift, don't reinvent)
- **Logic:** `validateProperty` / `EMPTY_PROPERTY_FORM` / `toNumberOrNull` / `fromProperty` / payload builder (from `PropertyFormSheet.tsx`), `PropertyPhotoField`, `derive-properties` — promote to shared.
- **Data:** `useAdminProperties` (list + realtime), `updateProperty` (edit), the joined-homeowner transform.
- **Primitives:** `Sheet` (right side), `Field` from `bookings/detail-atoms.tsx`, `FormField`, `Input`, `Textarea`, `Button`, `Badge`/pill, `ListFilterBar`, `Skeleton`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `DiscardChangesDialog`, `toast`.
- **Patterns:** `OperatorCustomers` list↔sheet structure; `CustomerDetailSheet` canEdit/editing/onSave contract; `OperatorBookingDetailHost` `?param=` shell host; R1 Calendar nav-add.
- **New primitive?** None required. Property photos stay single-hero (no `PhotoGalleryGrid`). If any genuinely-new pattern appears, formalize it into `ui/*`, don't inline.

## 9. Testing
- **Unit** (`*.test.ts`, `src/lib/**`): the delete-bucket logic (`archiveOrDeleteProperty` decision: never-booked→hard-delete, history→archive, live→cancel+archive; permission gating), the booking-seed param builder, and the archived read filter helper. Reuse the existing `validateProperty.test.ts` / `derive-properties.test.ts` patterns.
- **Integration** (`*.integration.test.ts`): none required for CRUD (no routes — RLS coverage already exists in `manager-services-properties-rls.integration.test.ts`). Add an RLS integration test only if a new route is introduced (it should not be). Consider extending the RLS test to cover the `archived_at` UPDATE path under `can_edit_properties`.
- **E2E** (`tests/e2e/`): a happy-path — open Properties, create, edit, assign/remove homeowner, book-from-property, and the delete warning card — is worthwhile but scope it in the plan against existing E2E coverage.
- **Migration:** `npx supabase db reset` rebuilds cleanly; the publication add is idempotent.

## 10. Rollout / flags
Behind `NEXT_PUBLIC_REDESIGN_ENABLED` like the rest of the operator console. Homeowner-assignment block additionally behind the self-pay UI flag (`stripeSelfPayUiEnabled()`), matching legacy. No new env vars. Legacy `PropertiesPage` stays until global cutover.

## 11. Copy & design guardrails
No em dashes in any user-facing copy (use periods/commas/parens). Warning-card and empty-state copy must be plain and specific ("This property has 3 upcoming cleanings that will be cancelled."). Badge vocabulary for `Org-owned`; no decorative accent bars. Photos are property identity photos — keep them visually distinct from cleaner job before/during/after photos (a separate concern).

## 12. Follow-ups (out of scope, note in PR)
- **Archived-properties view / un-archive** (retrieve an archived property). R4 only creates archived rows; there's no UI to see or restore them yet.
- **Bulk delete / multi-select** (legacy had it; risky with the archive model — defer).
- **Multi-photo gallery** (needs a new table/bucket-listing + a `PhotoGalleryGrid` primitive).
- **Homeowner/operator property-stack unification** (R4 lifts shared logic but does not merge the two UIs).
- **`bathrooms` half-values** (schema is integer).
- **Reject archived `property_id` at booking creation (all by-id paths).** R4 filters archived properties out of every picker/list, but by-id booking-prefill deep-links (`AddAppointmentModal.tsx:484/:541`) and `api/appointments/request/route.ts:67` still resolve an archived property by id, so a stale deep-link could book an archived property. Add an `archived_at IS NULL` guard at the booking-creation paths (not just the reads) as defense-in-depth. (Surfaced by the Task 3 review, 2026-07-11.)

## 13. File-by-file change map (for the plan)
**New:** migration `1xx_properties_archive_and_realtime.sql`; `properties/OperatorProperties.tsx`, `PropertyDetailSheet.tsx`, `OperatorPropertyDetailHost.tsx`, `PropertyDeleteDialog.tsx`, `useOpenProperty` (operator `?property=`), shared `properties/` logic module; unit tests.
**Edit:** `shell/nav-items.ts` (+snapshot test), `OperatorShell` (mount host), new route `properties/page.tsx`; `useAdminData.ts` (`archiveOrDeleteProperty`, archived filter on `useAdminProperties`); `CustomerDetailSheet.tsx` (+ its VM/props) for the deep-link; `usePropertiesByOwner.ts`, `OperatorBookingForm.tsx`, `OperatorBookingHost.tsx`, `operatorBookingParams`, `useOpenOperatorBooking.ts` (seed params + inline add); `src/types/index.ts` (Property type); homeowner property reads (archived filter only); promote shared `validateProperty`/`PropertyPhotoField`.

---
*Design validated with the browser companion (list layout = dense table for console consistency; detail sheet read→edit with homeowner assign/change/remove; delete = warn-and-override with cancel-upcoming + archive-history, hard-delete never-booked; both booking wires in scope). Implementation must ship from the design system per §2.*
