# Redesign functionality audit — dead buttons + legacy gaps

> Produced 2026-07-09 by a 45-agent audit workflow (15 per-surface dead-button finders + 5 legacy-vs-redesign gap analysts, every finding adversarially verified, plus a completeness critic and a follow-up round on the areas it flagged). Trigger: the "Needs you now" Assign buttons were discovered to be non-functional; this sweep found everything else in that class before cutover.
>
> Verdicts: 24 button findings verified (9 CONFIRMED dead/stub, 6 refuted as actually wired, rest PARTIAL = works but degraded); 62 legacy-parity gaps verified (60 confirmed). REFUTED findings are excluded below.

---

## 1. Genuinely dead or stubbed controls (fix these — a user clicks and nothing happens)

> ✅ **All six fixed in PR #134** (merged 2026-07-09): queue rows + buttons wired to open the booking detail (gated on `can_view_bookings`; since the host landed they open the sheet in place), homeowner Add image sends attachments, settings sections render an ErrorState with retry, self-pay card rows are display-only mirroring the server's default-else-first choice, marketing demo buttons simulate.

| # | Where | What | Severity |
|---|---|---|---|
| 1 | `src/components/redesign/overview/NeedsYouNowQueue.tsx:74` | **Assign / Force-assign / Review** buttons on every queue row render with no `onClick`, no link, no form. Prop chain carries only `{id,title,subtitle}` — no callback or href exists anywhere up through `OperatorOverview`. Clicking silently does nothing. | major |
| 2 | `src/components/redesign/overview/NeedsYouNowQueue.tsx:66` | The queue **row cards** are styled clickable (`cursor-pointer`, hover border/bg, focus ring) but have zero interactivity. Fix together with #1: row opens booking detail, button performs the action. | major |
| 3 | `src/components/redesign/homeowner/messages/HomeownerMessageThread.tsx:118` | Homeowner office-thread composer **"+ Add image"**: opens the OS file picker, then silently discards the selection — `onAddFiles` is `() => {}`, `pendingFiles` hardcoded `[]`. Backend already supports attachments (`useSendMessage` uploads to the `message-attachments` bucket); mirror the wiring in `CleanerThread.tsx:61,123-124`. | major |
| 4 | `src/components/redesign/bookings/new-booking/BookingPaymentField.tsx:133` | Self-pay **company saved-card rows** render as real buttons with hover + selected states but `onSelect={() => {}}`. Server also ignores any selection (charges default-else-first, `chargeCompletedAppointment.ts:361`). Either make rows display-only or wire per-booking company-card choice end to end. Wart: with no default card set, the UI highlights nothing while the server will still charge `methods[0]`. | minor |
| 5 | `src/components/redesign/settings/useSettingsSection.ts:25` | All 6 settings sections (Profile, Organization, Cancellation, Payout, Cleaner experience, Business hours) **swallow load failures**: `loadError` is set but never rendered by any consumer, so a real failure shows a skeleton forever with no retry. (Transient "no org yet" self-heals; genuine failures don't.) | minor |
| 6 | `src/components/marketing/CapabilityExplorer.tsx:261-262` | Marketing demo Payments tab: **"Fix card"** and **"Copy card link"** buttons are inert (the Overview demo tab's Assign buttons simulate a toast; these do nothing). Give them a simulated interaction or make them display-only like the CrewTab switches. | minor |

Honest placeholders verified as fine (no action needed): the "Hourly (coming soon)" payout radio (`PayoutSettingsSection.tsx:58`, deliberately disabled + server rejects the value) and the cleaner Availability "Coming soon" card (employee-model orgs, clearly labeled).

## 2. The systemic class: redesign controls that escape into the legacy shell

These all "work" today because the legacy dashboard still exists, but every one **breaks at cutover** and several drop their context on the way. This is the load-bearing follow-up theme; the shared root cause is that the redesign shell has **no appointment-panel host** (the cleaner shell's `?job=` host is the model) and handlers route to `/admin-dashboard?tab=...` instead.

| Where | Control | Degradation |
|---|---|---|
| `src/components/redesign/bookings/OperatorBookings.tsx:382-384` (JSX `BookingDetailSheet.tsx:267`) | **Reschedule** | ✅ Fixed (R2/R3 build, 2026-07-10): opens the native `RescheduleDialog` stacked over the sheet; the legacy `/admin-dashboard?tab=bookings&appointment=` escape is deleted from `OperatorBookingDetailHost`. |
| `src/components/redesign/messages/OperatorMessages.tsx:275` (JSX `ContextPanel.tsx:73`) | **New booking** (conversation About panel) | ✅ Fixed (PR #135): opens the in-shell `?newbooking=1` sheet, set in place so the thread's `?c=` survives. |
| `src/components/redesign/notifications/deriveNotifications.ts:84` | **All appointment-scoped notification clicks** incl. the "Assign cleaner" chip | ✅ Fixed: hrefs repointed into the redesign shell (PR #135); booking-targeted rows now open the detail sheet in place via the shell host (`NotificationItemVM.bookingId` + bell `onOpenBooking`). |
| `src/components/redesign/payments/usePaymentsTriage.ts:282` | **Fix card** (failed-charge triage) | Opens the legacy side panel because the redesign has no per-booking payment-method UI (gap R6). |
| `src/components/redesign/payments/usePaymentsTriage.ts:292` + `OperatorPayments.tsx:339` | **Message {cleaner}** (triage band + payout detail sheet) | ✅ Fixed (PR #135): routes to redesign Messages `?to=<cleanerId>`, which creates/opens the thread itself. |
| `src/components/redesign/messages/OperatorMessages.tsx:261` (+ `MessageBubble.tsx:27`, `InlineBookingCard.tsx:15`) | **Open booking** chips/rows across Messages | ✅ Fixed: repointed to the redesign booking deep link (PR #135), now opens the sheet in place via the shell host, preserving the open thread's `?c=`. |
| `src/components/redesign/messages/ContextPanel.tsx:71` | **Profile** (About panel) | ✅ Fixed (PR #135): deep-links the person (`?cleaner=` / `?customer=`). |
| `src/app/reset-password/page.tsx:157`, `src/app/accept-invite/page.tsx:266` | Post-success redirects | ✅ Fixed (PR #136): both use the shared flag-aware `getDashboardPath`. |

## 3. Legacy features with no redesign home (must-haves)

Deduped across the admin + manager analyses (managers share the operator console):

| # | Gap | Status | Notes |
|---|---|---|---|
| R1 | **Calendar / scheduling cockpit** (month/week/day/agenda, per-cleaner dispatch lanes, drag-to-reschedule w/ conflict detection, slot-click-to-create) | missing | Zero calendar components under `src/components/redesign/**`. The single biggest missing surface. |
| R2 | **Reschedule flow** (new date/time + conflict detection + cleaner swap + fresh response deadline + `notifyReschedule` + adopt counter-windows) | ✅ done | R2/R3 build (2026-07-10): native `RescheduleDialog` (suggestion chips + window time pills, conflict warn with force override, outcome preview from the shared `rescheduleOutcome` module, tiered re-ask deadlines) backed by `POST /api/appointments/[id]/reschedule` (atomic status gate, routing-log closure, request_state handling, smart-skip re-ask policy). |
| R3 | **Edit booking after creation** (date/time, service+checklist swap w/ reprice, price override, special requests, notes) | ✅ done | R2/R3 build (2026-07-10): Edit-details body swap inside `BookingDetailSheet` (service/checklist swap with change-driven reprice, price override, special requests, notes; dirty-close guard on every exit path) backed by `PATCH /api/appointments/[id]/details` with the paid-charge guard. Date/time edits go through the Reschedule dialog (R2). |
| R4 | **Operator Properties workspace** (create/edit/delete, photos, special instructions, assign homeowner, book-from-property) | missing | No Properties nav destination; properties are read-only inside `CustomerDetailSheet`. An operator taking a phone booking for a new address is stuck — also blocks booking for customers with zero properties. |
| R5 | **Org company payment methods** (self-pay cards/banks: add/remove/set default) | missing | Redesign settings Payments only mounts Stripe Connect. The booking form's empty state literally says "Add one in Settings, Payments" — a dead end. A redesign-only org can never make a self-pay booking. |
| R6 | **Per-appointment payment method view/change + failed-charge recovery (operator)** | partial | Triage band surfaces failures and "Send card link" works, but nothing in the redesign re-runs the failed charge and `BookingDetailSheet` has no payment-method section; the end-to-end fix depends on the legacy panel. |
| R7 | **Homeowner failed-payment self-recovery** (see card on an appointment, change it, retry banners) | missing | `HomeownerCleaningDetail` has no payment-method section; the only signal is a "Payment failed" badge with no fix path. Under charge-at-completion this is the homeowner's only self-service unblock. |
| R8 | **Operator cancel with cancellation-fee handling** | ✅ done | R8 build (2026-07-10): `CancelBookingDialog` (party selector, no-show, reason, live fee preview via the shared `computeCancellationFee`, fail-closed policy load) submits the Stripe-aware cancel route. Gated on the new-charge-flow flag + payment permission (owner/admin or manager with `can_manage_payments`); soft-cancel confirm retained for everyone else and for flag-off. |
| R9 | **Job photos (before/during/after) visible to operator** | missing | No photos section in `BookingDetailSheet`; evidence trail for disputes/fee decisions is gone. |
| R10 | **Action Center completeness**: SLA-overdue bucket + per-attempt routing/decline history | partial | `deriveOverview.ts` has no overdue bucket; overdue bookings appear in NO queue. Routing-attempt log not ported. (Plus the dead buttons in §1.) |
| R11 | **Cleaner multi-slot offer chips show time only** | ✅ done | Fixed in PR #137 (`offerSlotChipLabels` presenter: date-aware labels when slots span days). |
| R12 | **Legacy deep-link repointing** (the full §2 list) | mostly done | PRs #135 + the booking-detail host + the R2/R3 build resolved every §2 escape except the Fix card (R6), which stays legacy until that surface exists. Reschedule is now native (R2). |

## 4. Nice-to-haves (pilot could launch without, decide deliberately)

- **Invoices tab** (Finance) — not ported.
- **Analytics**: custom date range, property/cleaner filters, PDF export.
- **Live job checklist progress** visible to the operator.
- **Bookings time-window filter** (next 7/30 days etc.).
- **Cleaner**: calendar view of own jobs; before/after photo review on in-progress/completed jobs; conversation search + role filter.
- **Homeowner**: photo attachments in messages (the §1 #3 stub is the entry point); full job-photo gallery w/ lightbox; past-cleanings search + load-more.
- **Operator**: bulk cleaner payout-% editor; staff profile edit (name/email/phone); all-invites view incl. homeowner invites + resend; "availability/conflict-aware" cleaner assignment hints.
- **Manager visibility into business settings** (read-only cancellation policy etc.).
- **Platform-owner impersonation awareness** in the redesign shell (ImpersonationBanner is legacy-chrome only).

## 5. Platform-owner back-office (known-deferred, now enumerated)

The `/owner` surface was never in redesign scope; the audit enumerated what it does so cutover doesn't strand it: tenant roster + KPIs + tenant detail, provision tenant (+ founder owner-invite email), "View as this company" impersonation (verified working), tenant/per-cleaner Stripe Connect reset actions, delete organization (cascading), platform fee display, tenant Stripe Express login link. `getDashboardPath` has no case for the platform-owner role (falls through to `/`). Decision needed: redesign it, or keep the legacy `/owner` page alive past cutover.

## 6. Deliberate skips (confirmed legacy-only, do not port)

Security settings (password/2FA page), notification preferences (both already deferred on the record), delete-conversation, homeowner conversation search/role filter, homeowner property search, cleaner counter-propose windows (product decision was operator-driven windows), manager access to staff management + booking delete (now owner/admin-only by design, PR #132).

## 7. Suggested sequencing

1. **Quick wires (no design needed):** §1 #1-#5 fixes, ContextPanel Profile deep link, Message-cleaner `?to=` repoint, New-booking `?newbooking=1` repoint, auth redirect flag fix, cleaner slot date labels (R11). ✅ **DONE** (PRs #134-#137, merged 2026-07-09).
2. **One structural piece unlocks most of §2:** a booking-detail host in the operator shell (`?booking=` param, model: cleaner shell's `?job=` host) so notifications/messages/payments all deep-link in-shell. ✅ **DONE** (`OperatorBookingDetailHost` mounted in `OperatorShell` behind `can_view_bookings`; owns `?booking=` on every operator page; overview queue, message booking chips, and booking-targeted notifications open the sheet in place. Reschedule and Fix card still hand off to legacy pending R2/R3 and R6).
3. **Bigger UI builds (browser-companion candidates):** calendar cockpit (R1), reschedule + edit-booking (R2/R3 — likely one booking-edit surface), Properties workspace (R4), org payment methods in settings (R5), operator payment-method + photos sections in BookingDetailSheet (R6/R9), homeowner payment recovery (R7), overview action-center completion (R10 + §1).
4. **Decide:** platform-owner back-office (§5) and which §4 nice-to-haves make the cutover bar.
