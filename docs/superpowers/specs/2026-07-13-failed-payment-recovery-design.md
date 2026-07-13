# Failed-payment recovery + card-link email (R6, R7) — design

**Date:** 2026-07-13
**Audit gaps:** R6 (operator per-appointment payment view/change + failed-charge re-run), R7 (homeowner failed-payment self-recovery). Plus a scoped enhancement: **email the card link** (replacing today's copy-to-clipboard). Also lands the **collapsible information architecture** for `BookingDetailSheet` (IA option B), which R9/R10 will build on later.
**Status:** approved design (companion mockups signed off 2026-07-13). **Revised after a 3-lens adversarial critique** (security / feasibility / completeness) — see the "Revision notes" at the end. Predecessor R5 (org self-pay cards) shipped in PR #144.

---

## 1. Overview & goals

Under the new charge-at-completion flow a card is saved at booking and charged when the job completes. A **failed charge** currently has no in-redesign recovery path: the operator "Fix card" button escapes to the legacy `/admin-dashboard` drawer (the last legacy escape hatch, audit §2), and the homeowner only sees a "Payment failed" badge with no fix.

This slice closes both:

- **R6 (operator):** a real Payment section inside `BookingDetailSheet` — view the card on file + payment status, **Change card**, **Retry charge**, **Email card link** — gated by `can_manage_payments`. Deletes the legacy "Fix card" escape.
- **R7 (homeowner):** a Payment section inside `HomeownerCleaningDetail` — see the failed status, **Update card**, **Pay now** (immediate retry), with a "Paid" confirmation.
- **Email the card link:** the operator's "Email card link" sends a real branded email via the existing **Brevo SMTP** account (nodemailer), replacing copy-to-clipboard. Graceful fallback to copy-link when SMTP is not configured.
- **IA refactor:** restructure the crowded `BookingDetailSheet` into the approved **collapsible** layout, introducing a reusable `Collapsible` primitive that R9 (photos) and R10 (routing history) will reuse.

**Everything reuses existing backend where possible.** The charge route (`POST /api/appointments/[id]/charge`) is both the initial and the recovery charge; the change-card route (`POST /api/appointments/[id]/payment-method`) already validates ownership, clears the failed state, and already allows the `homeowner` role. New backend work: (a) a scoped homeowner extension of the charge route, (b) **per-appointment charge serialization** to prevent a double-charge race, and (c) the email sender + wiring.

### Delivery plan / sequencing (adopted from the scope critique)

Ship as **two PRs** off this one spec, so the recovery UX is not blocked on the user's Brevo credentials:

- **PR 1 — Payment recovery (core):** `Collapsible` primitive + IA refactor, R6 operator section, R7 homeowner section + the scoped charge-route extension, and the charge-serialization fix. All UI + one backend route change, no external dependency. "Email card link" ships here reusing today's **copy-link** behavior.
- **PR 2 — Email delivery:** nodemailer + Brevo wiring, the sender modules, the on-brand template, and switching "Email card link" from copy to email. Mergeable independently once the `SMTP_*` env is set; gracefully falls back to copy-link until then.

Each PR gets its own review + gates. The rest of this spec is written as one design; the plan will split tasks along this boundary.

---

## 2. UI implementation & styling source (contract)

**The browser-companion mockups for this feature are UX/structure reference ONLY.** Every screen is implemented from the design system: the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` + `src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft "pillowy" shadows, the rounded scale). Do **not** copy ad-hoc colors, raw hex, the card-chip gradient, or bespoke classes from a mockup. Status/urgency uses the badge/pill vocabulary (`PaymentBadge`, `BookingStatusBadge`), never decorative side-accents. Reuse existing primitives (`Button`, `PaymentBadge`, `Sheet`/`Drawer`, `Select`, `EmptyState`, `ErrorState`, `Skeleton`, the shared `payment-methods` components). The one genuinely new pattern — a lightweight collapsible section — is built as a reusable primitive (`src/components/ui/collapsible.tsx`), not an inline one-off. No em dashes in any user-facing copy.

---

## 3. Information architecture — `BookingDetailSheet` collapsible refactor

Today the sheet is a flat `space-y-5` scroll of ~11 `<Separator/>`-divided sections. Adopt **IA B (collapsible)**:

**Always visible (open):** header (status badges, title, service), Date/Time, Customer, Cleaner (assign/select), **Payment (R6)** (kept open — the triage focus), and the pinned Action grid + Delete at the bottom.

**Collapsible (a titled row with a chevron; independently toggled):**
- **Conversation** — wraps the existing `JobMessagesPanel`. Collapsed by default (heavy; fetches a thread).
- **Requests & notes** — wraps Special requests / Decline reason / Notes when present. Collapsed by default.
- *(Future, not this slice: **Photos** (R9) and **Routing history** (R10).)*

**Unchanged inline:** Message customer/cleaner buttons, Cleaner counter-proposals / counter-windows (already conditional and short).

**New primitive — `src/components/ui/collapsible.tsx`:**
- A single, independently-toggled collapsible section (NOT single-open like the existing `Accordion`).
- Reuses the accordion's smooth `grid-template-rows: 0fr/1fr` height animation and a11y wiring (`aria-expanded`, `aria-controls`, `role="region"`), with **light inline chrome** matching the sheet (a title row + chevron + optional right-side slot for a badge/summary, then the panel).
- Props: `title` (string|node), `defaultOpen?`, `right?` (badge/summary node), `children`. Uncontrolled local open state so sections toggle independently. The sheet unmounts on close (Radix), so open-state resets per open — acceptable.

---

## 4. R6 — operator Payment section

Lives where the current display-only payment block is (`BookingDetailSheet.tsx` ~287-304), expanded into a full section. **Gating** (existing pattern; the sheet already receives `canViewPayments` + `canManagePayments`): `canViewPayments` → status + card on file + total (read); `canManagePayments` → the action buttons (owner/admin bypass; manager needs `can_manage_payments`, re-checked server-side).

### 4a. "Card on file" data source (was missing)

Neither `AdminAppointment` nor `BookingDetailVM.payment` carries the attached card. Add it:
- Include **`appointments.payment_method_id`** in the admin appointments fetch (`useAdminData`/`useAdminAppointments`) and the VM.
- Resolve the on-file card by fetching the homeowner's saved cards via the staff route `GET /api/stripe/saved-payment-methods?homeowner_id=&organization_id=` (allowedRoles owner/admin/manager) and matching `payment_method_id`. The same list powers the Change-card picker (with the on-file card marked "current"). Reuse the shared `PaymentMethodRow`.

### 4b. State machine (presenter over `authorization_status` + `payment` status + `is_self_pay` + job status)

| State | Trigger | Shows | Actions (canManagePayments) |
|---|---|---|---|
| **Failed** | `authorization_status = 'failed'` | "Failed" badge, total, card on file, decline reason if any | **Retry charge** (primary), Change card, Email card link |
| **Needs authentication** | `authorization_status = 'requires_action'` | "Action needed" badge, "customer must confirm with their bank" | **Email card link** (primary), Change card. **No Retry** — an off-session re-charge cannot clear 3DS and just re-returns `requires_action`; recovery is the on-session card-link/add-card SetupIntent. |
| **Before charge** | job not completed, card on file, no failure | "Card on file", total, "charged when the job is completed" | Change card, Email card link |
| **Paid** | `payment = 'paid'` / `authorization_status = 'captured'` | "Paid" badge, amount + date, card used | none (view only) |
| **No card on file** | no `payment_method_id` | "No card on file" | Email card link (add a card) |
| **Self-pay** | `is_self_pay` | "Self-pay" badge, company card (masked) | none here; "Managed in Settings › Payments" (R5) |

Badge tones use the existing `PaymentBadge` vocabulary; "Action needed" maps to a caution/amber tone (add a `PaymentBadge` variant only if none fits).

### 4c. Retry-charge outcome mapping (deterministic — do NOT optimistically show "Paid")

`Retry charge` → `POST /api/appointments/[id]/charge`. On response, **invalidate the appointment query and drive the badge from the returned code** (`ChargeNowCode` / `HTTP_BY_CODE`):

| Response | Badge/result | UI |
|---|---|---|
| `charged` (200) | Paid | success toast, section → Paid |
| `processing` (200, ACH/bank) | Processing | info toast, section → Processing (not Paid) |
| `requires_action` (402) | Action needed | switch to the requires_action sub-state (lead with Email card link) |
| `declined` (402) | stays Failed | inline error with the returned message ("Declined again") |
| precondition `409`s (`tenant_not_ready`, `no_card`, `no_org_card`, `cleaner_not_payable`, `not_chargeable`) | stays Failed | specific inline message, no state flip |

### 4d. Change card / Email card link

- **Change card** → picker of the homeowner's saved cards (4a) → `POST /api/appointments/[id]/payment-method` (existing; validates the PM belongs to the homeowner's Customer, sets it, **nulls `authorization_status`** and bumps `reauth_count`, flips the payments row `failed→pending`). The picker only lists **already-attached** cards; when the homeowner has no alternative card, the picker **degrades to "Email card link"** (operators cannot add a card on the homeowner's behalf inline).
- **Email card link** → `POST /api/billing/card-links` (see §6). Success: "Payment link emailed to {customer}" (or "link copied" on fallback).
- **Delete the legacy escape:** remove the `fixCard` → `/admin-dashboard?tab=bookings&appointment=` navigation in `usePaymentsTriage.ts`; triage "Fix card" opens the redesign booking sheet (`?booking=`) in place.

---

## 5. R7 — homeowner Payment section

Lives in `HomeownerCleaningDetail` (`src/components/redesign/homeowner/cleanings/HomeownerCleaningDetail.tsx`). Consumer tone, mobile-first. Reuses the homeowner's existing saved-cards/add-card infra (`useSavedPaymentMethods`, `CardPickerSheet`, `AddCardSheet`).

### 5a. Data layer (was under-specified — R7 is not buildable without this)

The homeowner `Appointment` type (`src/hooks/useHomeownerData.ts`) carries only `payment_status`. Extend the homeowner appointments fetch + interface to add:
- **`organization_id`** — `POST /api/appointments/[id]/charge` requires it in the body and for the membership lookup; without it "Pay now" cannot call the route.
- **`authorization_status`** — to distinguish a plain decline (`failed`) from 3DS (`requires_action`); `payment_status` alone conflates them.
- **card metadata** (`payment_method_id` + brand/last4, resolved via the homeowner's own `/api/stripe/my-payment-methods`) — for "card on file" and "Charged to Visa •••• 4242".

### 5b. States

| State | Shows | Actions |
|---|---|---|
| **Failed** (`authorization_status='failed'`) | "Payment failed" + "We couldn't charge your card for this cleaning" + card on file + total | **Pay now · $X** (primary, immediate retry), **Update card** |
| **After Pay now succeeds** | "✓ Paid $X" ("Charged to Visa •••• 4242 just now") | none |
| **Processing** (ACH) | "Payment processing" | none (informational) |
| **Needs authentication** (`requires_action`) | "Confirm your payment" | **Update card** only (a fresh card via the on-session SetupIntent is the real fix). **No "Pay now"** — off-session retry loops on 3DS. |
| **Before charge** | "Card on file · you'll be charged $X after your cleaning is completed" | Update card |
| **Paid** | "$X paid on {date} · Visa •••• 4242" | none (view only) |

The section is calm/informational unless a charge has actually failed.

### 5c. Backend — scoped homeowner extension of the charge route

`src/app/api/appointments/[appointmentId]/charge/route.ts`: **widen the appointment SELECT** to include `homeowner_id, status, authorization_status` (currently only `organization_id, is_self_pay, cleaner_id`), then add an **explicit fail-closed allowlist branch** before charging:

```
if (auth.role === 'homeowner') {
  require appt.homeowner_id === auth.userId
       && appt.status === 'completed'
       && appt.authorization_status === 'failed'   // NOT requires_action (3DS loop)
       && !appt.is_self_pay;                        // self-pay is company-funded
  else 403;
}
```

Amount + card are server-derived by `chargeCompletedAppointmentAuto`; the homeowner never supplies either. **Defense in depth:** the self-pay path (`chargeSelfPayNow`) performs no caller authorization, so also reject a non-staff actor from the self-pay branch in the orchestration, so a future route regression can't let a homeowner trigger a company-card charge. Negative integration tests: homeowner charges own failed completed appt (ok); someone else's appt (403); own non-failed/not-completed appt (403); own `requires_action` appt (403, not a loop); own self-pay appt (403).

---

## 6. Email the card link (Brevo SMTP via nodemailer)

**Current state:** no transactional email provider is wired; all app email goes through Supabase Auth (auth links only). The card-links route already reads `user_profiles.email` and builds the link.

**Approach:** reuse the existing **Brevo (Sendinblue)** account over SMTP with **nodemailer**. Brevo already delivers the app's auth email, so the sending domain is already verified — no new DNS.

**New env vars (server-only):** `SMTP_HOST` (e.g. `smtp-relay.brevo.com`), `SMTP_PORT` (`587`), `SMTP_USER` (Brevo SMTP login), `SMTP_PASS` (Brevo SMTP key), `EMAIL_FROM` (e.g. `Nexxus <noreply@yourdomain>`).

**New modules:**
- `src/lib/email/transport.ts` — lazily builds a nodemailer transport from `SMTP_*`; exposes `emailConfigured()`; never throws at import.
- `src/lib/email/sendEmail.ts` — a tiny mockable `sendEmail({ to, subject, html, text })` (mirrors `src/lib/auth/passwordReset.ts`).
- `src/lib/email/templates/cardLinkEmail.ts` — a pure `{ subject, html, text }` builder, on-brand (Nexxus, brand `#0150FC`), inline styles only. **HTML-escape every interpolated dynamic value** (homeowner name is operator-settable input, not self-owned) — only the server-built `href` carries the token.

**Wiring** (`src/app/api/billing/card-links/route.ts`):
- Add `export const runtime = 'nodejs'` (nodemailer needs Node).
- **Build the emailed URL from a trusted server base (`APP_URL` / `NEXT_PUBLIC_APP_URL`), NOT `request.nextUrl.origin`** — matching the invite-email convention (`admin/send-invite`, `platform/organizations`). A request-Host-derived origin in an auto-sent email is a phishing / token-exfiltration vector. (`request.nextUrl.origin` may remain only for the copy-link fallback returned to the operator's own browser.)
- Accept an optional body flag `deliver?: 'email' | 'copy'` (default `email` when `emailConfigured()`, else `copy`).
- After the successful `homeowner_payment_links` insert, if delivering by email, `sendEmail` to `profile.email` with the `cardLinkEmail` template. Return `{ url, delivered }`. **Email-send failure does not fail the request** — log (optionally classify via `src/lib/monitoring/authEmailHealth`) and fall back to `delivered: 'copy'`.
- Integration test: mocks `sendEmail`; asserts email path calls it with the homeowner email + the tokened URL when configured, and that an unconfigured/erroring send still returns the URL with `delivered: 'copy'`.

**Client** (`usePaymentsTriage.ts` + the R6 button): show "Payment link emailed to {customer}" when `delivered === 'email'`; keep copy-to-clipboard when `delivered === 'copy'`.

---

## 7. Backend / data model summary

- **No database migration.** No schema changes. `authorization_status` is unconstrained `text` (the CHECK was dropped in migration 087), so the charge-serialization sentinel below needs no migration.
- **Charge serialization (double-charge fix):** R7 adds a second human actor, so an operator "Retry charge" and a homeowner "Pay now" can fire within the Stripe-latency window. Because each attempt bumps `reauth_count` (read-then-write, unlocked) and the idempotency key is `charge-{appt}-{reauthAttempt}`, the two can compute different keys → **two real charges**. Fix: **atomically claim the charge per appointment before running it** — a conditional `UPDATE appointments SET authorization_status='charging' WHERE id=? AND authorization_status IN ('failed','requires_action') RETURNING reauth_count`. The row-winner charges; a loser (0 rows) returns `409 charge_in_progress`, surfaced as "a retry is already running." `finishCharge` overwrites `'charging'` in a `finally`, and the reconcile sweep treats a stale `'charging'` (older than a threshold) as recoverable so a crash mid-charge can't strand it. (Implementer verifies the exact `nextReauthAttempt` interaction.)
- **Route changes:** charge route (homeowner extension + serialization), card-links route (email + `runtime`).
- **New env vars:** `SMTP_*`, `EMAIL_FROM` (server-only; user provides from Brevo). Absence = copy-link fallback.
- **New deps:** `nodemailer` (+ `@types/nodemailer` dev). *(PR 2 only.)*
- **Change-card clears state as `authorization_status = null`** (not `'pending'`); the payments row goes to `pending`. Any optimistic UI keys "cleared" off `null`.

---

## 8. Permissions & security

- R6 actions gated by `can_manage_payments` in the UI and re-checked server-side (fail closed), mirroring R8's CancelBookingDialog.
- R7 charge extension: tight fail-closed allowlist (own appt + `completed` + `authorization_status='failed'` + not self-pay + server-derived amount) with defense-in-depth on the self-pay path. Covered by negative integration tests.
- **Double-charge:** serialized via the atomic claim (§7).
- **Emailed link:** built from a pinned server base, not the request Host; token-gated (`homeowner_payment_links`, 7-day TTL); all interpolated values HTML-escaped; SMTP creds server-only.
- Card data never touches our servers (Stripe Elements / hosted page).

---

## 9. Testing

- **Unit:** `Collapsible` primitive (open/close, a11y); payment-section state presenter (state → badge/actions) for R6 and R7, including the retry-outcome mapping (§4c); `cardLinkEmail` template (contains the link, escapes name, no raw PII beyond name).
- **Integration:** charge route homeowner extension (5 cases incl. `requires_action`→403); charge serialization (concurrent claim → one charges, other 409); card-links email path (sender mocked; configured + fallback).
- **E2E:** existing Playwright smoke where reachable; flag-gated Stripe flows not exercised without test config (noted, as with R5).
- Gates: `npx tsc --noEmit` (no new errors over baseline), `npm run lint`, `npm run test`.

---

## 10. Feature flags

- Payment sections + charge/change-card actions behind existing **`stripeNewChargeFlowUiEnabled()`** (client) / `stripeNewChargeFlowEnabled()` (server). When off, the sheet keeps its display-only payment block and the homeowner sees no fix path (status quo).
- Email delivery gated by **presence of `SMTP_*`** (`emailConfigured()`): configured → email; unconfigured → copy-link. Ships before the env is set.

---

## 11. Out of scope (explicit)

- **R9 (job photos)** and **R10 (routing/decline history)** — next slice; reuse the `Collapsible` primitive.
- **Refunds** from the operator sheet.
- **SMS** delivery.
- Reworking the hosted `/billing/add-card` page (reused as-is).
- Brevo HTTP transactional API (SMTP reuse chosen).
- Operator-side **add-a-new-card** inline (Change card only picks existing saved cards; new cards go via Email card link).

---

## 12. Decisions locked (do not re-litigate)

1. Sheet IA = **B (collapsible)**, new lightweight `Collapsible` primitive (independent toggle, not the single-open `Accordion`).
2. R6 actions = **Retry charge / Change card / Email card link**, gated `can_manage_payments`, deterministic outcome mapping, no off-session retry on `requires_action`; legacy "Fix card" escape deleted.
3. R7 = **Update card + Pay now** (immediate retry), homeowner charge-route extension scoped to `authorization_status='failed'` only; `requires_action` → Update card only.
4. **Double-charge** prevented via a per-appointment atomic claim (`'charging'` sentinel, migration-free).
5. Email via **Brevo SMTP + nodemailer**, emailed URL from `APP_URL` (not request Host), HTML-escaped, graceful copy-link fallback, no new DNS. **Shipped as its own PR (PR 2).**
6. **No migration.** New env vars + `nodemailer` dep only.

---

## Revision notes (post-critique)

Folded in from the 3-lens adversarial critique (2026-07-13): emailed URL from a pinned base not the request Host (security); atomic per-appointment charge claim to prevent an operator/homeowner double-charge race; HTML-escape email interpolation; explicit fail-closed homeowner charge guard + widened SELECT + self-pay defense-in-depth; `requires_action` made coherent (homeowner extension is `failed`-only, no off-session retry on 3DS anywhere); added the missing "card on file" data source (`payment_method_id` + saved-cards match) and the R7 data-layer extension (`organization_id`, `authorization_status`, card metadata); replaced optimistic "Paid" with a deterministic charge-response mapping; split email into its own PR (PR 2) so recovery ships without Brevo creds.
