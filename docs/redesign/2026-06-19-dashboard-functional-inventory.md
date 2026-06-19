# Nexxus Cleaning Platform — Functional Redesign Input

> Source of truth for a from-scratch dashboard redesign. Function only — no visual styling. Synthesized from 14 domain inventories spanning five roles (admin, manager, cleaner, homeowner, platform owner). The **Current navigation model (Section 5)** is captured as raw input to be reorganized, NOT preserved.
>
> _Provenance: produced 2026-06-19 by a 14-agent functional sweep + synthesis workflow. The current visual design is deliberately excluded — we are redesigning the view layer on the new primitive kit while reusing the existing headless data hooks._

---

## 1. Per-role job map

Top jobs-to-be-done in priority order, with the surfaces that serve each. This is the mental model to design around.

### Admin (org owner/operator, full CRUD)
The admin runs the whole operation for one cleaning company. The dashboard is a triage-and-dispatch console first, an admin/CRM tool second.

| # | Job-to-be-done | Surfaces that serve it |
|---|---|---|
| 1 | **Triage what needs my decision right now** (unassigned jobs, all-cleaners-declined, declined/overdue, counter-proposals) | Overview → Action Required queue; Appointment Detail Panel; AssignCleanerModal; RescheduleAppointmentModal |
| 2 | **See today's operational state** (jobs today, in-progress live, awaiting approval) | Overview KPI tiles + Active Now + Today's Schedule |
| 3 | **Create & manage bookings** (single + recurring, reschedule, cancel, bulk) | Bookings (list + calendar); AddAppointmentModal; Reschedule/Cancel/Bulk modals |
| 4 | **Get the business set up & paid** (Stripe Connect, services, invite cleaners) | Owner Setup Checklist; Settings → Payments; Services; Cleaner Management/Invites |
| 5 | **Track money in/out** (payments, payouts, invoices, failures) | Finance (Transactions/Payouts/Invoices); Payments Needing Attention |
| 6 | **Manage the workforce** (onboard cleaners, payout %, performance, permissions) | Cleaner Management; Team Members; Settings → Cleaner payouts / Team permissions |
| 7 | **Manage the customer & property book** | Customers; Properties; detail panels |
| 8 | **Define the catalog** (services, prices, checklists) | Services + ServiceDetailView + Checklists |
| 9 | **Communicate** with cleaners/customers/team | Messages |
| 10 | **Understand trends** | Analytics |

### Manager (delegated admin, permission-gated)
Same console as admin, but each capability is gated by one of 15 permission flags. Manager's mental model is "operate the slice I'm trusted with."

| # | Job-to-be-done | Surfaces | Gate |
|---|---|---|---|
| 1 | **Triage cleaner-response problems** (reassign declined/overdue, accept counters) | Overview Action queue; Appointment Detail Panel | `can_approve_decline_bookings` |
| 2 | **Manage bookings** | Bookings; New Booking Modal | `can_edit_bookings` |
| 3 | **Mark jobs complete** (triggers charge) | Bookings; Appointment Detail Panel | `can_edit_bookings` |
| 4 | **Handle payments/refunds** | Finance | `can_view_payments` / `can_manage_payments` |
| 5 | **Manage cleaners & team** | Cleaner Management; Team Members; Invites; Add Cleaner Modal | `can_manage_cleaners` |
| 6 | **Manage customers/properties/services** | respective tabs | `can_edit_*` / `can_manage_services` |
| 7 | **Communicate / analyze** | Messages; Analytics | `can_view_messages` / `can_view_analytics` |

> A flag with no access renders an "Access Denied" card; tab visibility and component-level actions are both gated. Revenue KPI falls back to "Unassigned count" when `can_view_payments` is off.

### Cleaner (field worker, mobile-first)
The cleaner's mental model is a work queue: respond to offers, do the job, get paid.

| # | Job-to-be-done | Surfaces |
|---|---|---|
| 1 | **Respond to job offers** (accept/decline/propose alternate time, against an SLA deadline) | Overview Pending Confirmations; Appointment Detail Panel; ConfirmAvailabilityModal |
| 2 | **Do today's job** (start → before photos → checklist → after photos → complete) | ActiveJobPage; JobPhotoSection; Checklist step; JobProgressIndicator |
| 3 | **Know what's coming up** | Overview Today/Upcoming; Jobs tab (list/calendar) |
| 4 | **Get paid & track earnings** | Earnings tab (Stripe embed + awaiting-payment list); Settings → Payouts |
| 5 | **Onboard for payouts** (Stripe Connect) | StripeConnectionCard; CleanerStripeConnect onboarding |
| 6 | **Communicate** | Messages |
| 7 | **Reference services/checklists** (read-only) | Services tab |

### Homeowner (customer, read-mostly)
Mental model: "book a cleaning, then watch it happen and pay for it." Only content-creation surface is the request.

| # | Job-to-be-done | Surfaces |
|---|---|---|
| 1 | **Request a cleaning** (property, service, slots, special requests, card) | RequestAppointmentModal; FAB / TopBar action |
| 2 | **Track my cleanings** (pending requests, today, upcoming, past) | Home (collapsible sections); Appointment Detail Panel (read-only) |
| 3 | **Manage payment methods** (save/remove/default card) | Payment Methods |
| 4 | **Review payment history** | Payments |
| 5 | **Browse my properties** (read-only) + book from one | Properties; PropertySidePanel |
| 6 | **Browse services** (read-only) | Services |
| 7 | **Communicate** with cleaner/admin | Messages |

### Platform Owner / platform_admin (Nexxus staff, separate app)
Runs the whole platform across all tenant companies. Lives at `/owner`, NOT the shared dashboard chrome.

| # | Job-to-be-done | Surfaces |
|---|---|---|
| 1 | **Monitor all tenant orgs** (count, plan/subscription status, payment readiness) | Platform Overview (stat cards + tenant list) |
| 2 | **Provision a new tenant** | ProvisionTenantModal |
| 3 | **Drill into one tenant** (settings, team, financials, Stripe reset) | Platform Org Detail |
| 4 | **Debug as a tenant** (audited read-only "View As") | View As → ImpersonationBanner (suppresses messages/notifications in shared chrome) |

---

## 2. Master screen / surface list

Grouped by job, not current nav. Each: purpose · roles · key data · primary actions.

### A. Triage & Overview
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Dashboard Overview / Home** | At-a-glance operational state + action queue + today | admin, manager, cleaner, homeowner | KPI tiles (today/in-progress/awaiting/revenue or unassigned); action queue; active-now; today's schedule; (cleaner) pending confirmations; (homeowner) pending requests | Drill into filtered Bookings; accept counter; force-assign; reassign; open detail; create/request booking |
| **Owner Setup Checklist** | Onboarding progress | admin (owner) | Stripe-connected, services-created, cleaners-invited progress | Navigate to each setup step |
| **Action Required / Action Center** | Unified queue of decisions needed | admin, manager | awaiting_assignment, all_cleaners_declined, cleaner_declined, cleaner_overdue, counter_proposed groups | Accept time; assign; reassign |
| **Pending Confirmations** | Job offers needing cleaner response | cleaner | awaiting appts + response deadline | Accept/decline/propose |
| **Active Now** | Live in-progress jobs (pulsing) | admin, manager, cleaner | in_progress appts | Open detail / ActiveJobPage |

### B. Bookings & Appointments
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Bookings / Jobs list** | Search/filter/manage all appts; list⇄calendar | admin, manager (full); cleaner (own, read-mostly) | per-appt: customer, cleaner, property, service, date/time, status, payment status, cleaner-confirmation status | search, filter (status/days), create, open detail, cancel/delete (single+bulk), reschedule, multi-select, calendar drag, start job (cleaner) |
| **Calendar view (Cockpit)** | Per-cleaner per-day grid, drag-to-reschedule | admin, manager (edit); cleaner (read-only) | day columns per cleaner; unassigned column | drag reschedule, click slot to prefill create |
| **AppointmentCard / CompactRow** | Summary row/card | all | date/time, property, service, people, price, status badges, recurring/self-pay badges, job-progress inline | open detail; select mode; start job (cleaner) |
| **Appointment Detail Panel** | Full appt detail + role/status actions | all | header, property, service, cleaner, special requests, notes, cleaner-response section, payment/card section, status | reschedule, confirm/decline, cancel, start job, change/add card, close |
| **AddAppointmentModal** | Create single/recurring appt (4 steps) | admin, manager, homeowner | homeowner/property → service+schedule+recurrence → cleaner → payment | step nav, pick entities, override price, set recurrence, pick cleaner, pick/defer card, submit |
| **RequestAppointmentModal** | Homeowner cleaning request (slots + alternates) | homeowner | property, service, primary+alternate slots, special requests, total, card | pick slots, add/remove alternates, select card, submit → awaiting_admin |
| **RescheduleAppointmentModal** | Change date/time or reassign cleaner after decline/timeout | admin, manager | appt summary, cleaner suggested times/windows, new date/time, cleaner picker, conflicts | apply suggestion, pick manually, pick cleaner, submit (auto-confirm vs send-to-cleaner) |
| **AssignCleanerModal** | Assign cleaner with multi-slot coverage + conflicts | admin, manager | ranked cleaners, coverage badges, conflict details, recency; forceMode variant | assign |
| **CancelConfirmModal** | Soft-cancel vs hard-delete | admin, manager | appt summary | cancel (→cancelled), delete (DB), keep |
| **BulkActionConfirmModal** | Confirm bulk cancel/delete | admin, manager | selected count | confirm bulk action |

### C. Active Job Execution (cleaner-only)
| Surface | Purpose | Key data | Primary actions |
|---|---|---|---|
| **ActiveJobPage** | Execute job: before photos → checklist → after photos → complete | homeowner/service names, progress step, photo counts, checklist completion | take/upload/delete photos, toggle checklist items, next/back, complete (validates photos, triggers charge) |
| **JobProgressIndicator** | Show position in 4-phase workflow | step %, three connected steps | read-only |
| **JobPhotoSection** | Capture/manage before/after photos (reused twice) | photo list, per-file upload progress, validation errors | take photo (camera), upload (multi), clear, delete, retry |
| **Checklist step** | Verify all tasks before proceeding | service+checklist name, line items, completed/total | toggle item, proceed (gated all-complete) |
| **NoPhotosWarningModal** | Warn before advancing without photos | photo type, warning | back to photos / continue anyway |

### D. Money — collection & payouts
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Finance: Transactions** | All incoming payments | admin, manager (`can_view/manage_payments`) | amount, customer, appt, status, method (card/ach/manual), notes | record manual, refund, view detail, search/filter |
| **Finance: Payouts** | Cleaner payout state | admin, manager | cleaner, ref, amount, status (pending/approved/paid/failed/reversed/bank_paid) | approve (legacy), view, search/filter |
| **Finance: Invoices** | Create/send/track invoices (TBD depth) | admin, manager | number, customer, amount, status (draft/sent/paid/cancelled), due | create, send, mark paid, cancel |
| **Payments Needing Attention** | Surface card-auth failures + failed payouts | admin, manager (new flow) | failed auths, failed payouts | re-authorize, send card link, retry payout, dismiss |
| **Homeowner Payment Methods** | Manage saved cards | homeowner | brand, last4, exp, default | add (PaymentElement), remove, set default |
| **Homeowner Payment History** | Charge record | homeowner | date, service, amount, status | view |
| **AppointmentPaymentSection** | Collect/defer card at booking | admin, manager (new flow) | saved cards, card-link generator | select card, generate link, refresh, defer |
| **Org Self-Pay Card/Bank Picker** | Company payment methods for self-pay | admin, owner | saved cards/banks, default, ACH-lower-fee nudge | switch default, add card/bank, remove |
| **Cleaner Earnings / Payouts** | Balance, next payout, history, awaiting payments | cleaner | Stripe embed (balance/next/bank), awaiting-payment list, payout history | open Stripe, onboard, review awaiting |
| **PaymentStatusBadge** | Consistent payment status display | all | paid/failed/pending/refunded/processing | render inline |

### E. Stripe Connect onboarding (shared infra)
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **PayoutsSection** (reusable, variant cleaner/tenant) | Single "show me my payouts" wrapper | cleaner, owner/admin/manager | variant, connected flag, timing notice | render connect/payouts, dismiss notice |
| **CleanerStripeConnect / TenantStripeConnect** | Embedded onboarding iframe ↔ payouts table | cleaner / owner | connect instance, status snapshot, requirements, drift (tenant) | mount onboarding/payouts, handle exit/step/error, drift hard-stop |
| **StripeConnectionCard** | Compact dashboard status widget + inline onboarding | cleaner | connect status | toggle inline onboarding, open Stripe |
| **StripeStatusHero** | At-a-glance status banner w/ role-aware CTA | owner/admin/manager/cleaner | status kind, title/desc, can-setup | set up / open dashboard / finish setup |
| **CleanerPayoutsHistory** | Own payout history (last 50) | cleaner | amount, status, date | view |
| **PayoutTimingNotice** | One-time dismissible timing explainer | all | timing, dismissed (localStorage) | dismiss |

### F. People — customers, properties, team, cleaners, invites
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Customers list + Detail Modal** | Manage homeowners; history per customer | admin, manager (full) | name, contact, properties/appts count, total spent, last appt | search, sort, add (invite), edit, delete (single+bulk), view appts/properties tabs |
| **Properties list + Side Panel** | Manage service addresses; photos; book from | admin, manager (full); homeowner (read-only) | address, owner, beds/baths/sqft, photo, special/access instructions, appt history | search, filter (owner/city/state), add, edit, upload photo, attach/change/remove owner (self-pay), delete, book |
| **PropertyPhotoUpload** | Single hero photo upload | admin, manager | current photo, preview, progress | pick, preview, upload, replace, cancel |
| **Team Members list + Side Panel** | Manage staff (admins/managers/cleaners/homeowners) | owner, admin, manager (`can_manage_cleaners`) | name, contact, role, (manager) permission count, (cleaner) availability/verified | search, filter, invite, edit, delete, manage permissions |
| **Cleaner Management list + Detail + Payout mode** | Onboard/monitor cleaners; payout %; performance | owner, admin, manager (`can_manage_cleaners`) | name, rating, jobs, availability, bg/insurance, payout %, Stripe status, hourly rate | search, add cleaner, edit, edit payout %, bulk payout update, delete |
| **Invites page + StatusBadge** | Track/resend invitations | owner, admin, manager (`can_manage_cleaners`) | email, role, status (pending/creating/superseded/failed/expired/accepted), sent/expiry, inviter | filter, search, resend, copy link, view |
| **Invite Acceptance Flow** | Invitee verifies OTP + sets password | invitee (any) | token, email, name, password | click link, verify OTP (on click), confirm, set password, accept |
| **Add modals** (Customer / Cleaner / Team Member / Property) | Create entity / send invite | admin, manager (+ owner) | role-specific fields | enter fields, submit/invite |

### G. Catalog — services & checklists
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Services list** | Manage service types | admin, manager (manage); cleaner, homeowner (read-only) | name, type, base price (+range), duration, active, checklist count/adder | add, search, filter status, view, edit, delete, toggle active |
| **Service Detail View** | Single service info + actions | admin, manager (+ read-only others) | full details, price range, timestamps | back, view checklists, edit, delete, toggle |
| **Service Form Modal** | Create/edit service | admin, manager | name, desc, price, duration, type, active | save, cancel |
| **Checklists View (per service)** | Manage checklists + line items (drag reorder) | admin, manager | checklist name, price adder, line items + positions | add/edit/delete checklist, add/edit/delete item, reorder |
| **Checklist Form Modal** | Create/edit checklist (draft-persisted) | admin, manager | name, price adder | save, cancel (discard guard) |
| **Delete Service/Checklist Modals** | Safe delete w/ usage check | admin, manager | usage counts (appts/series), item count | delete (gated), cancel |
| **SortableLineItem** | Inline task CRUD + reorder | admin, manager | task text, id, position | edit, delete, drag |

### H. Messaging (shared, role-permissioned)
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Conversation List** | Scan/select conversations | all | participant, last preview, timestamp, unread badge, role | search, filter by role, open, new, delete |
| **Message Thread** | Read history (infinite scroll) + send | all | messages, attachments (image grids), read status, participant header | scroll/paginate, send text/image, lightbox, back (mobile) |
| **New Conversation Modal** | Pick messageable member | all | org members (permission-filtered) | search, select → start/open |
| **Message Bubble / Input** | Render/compose messages | all | text, attachments, timestamps, read | send, attach images, Enter-to-send |

### I. Settings (role-gated sections)
| Surface | Purpose | Roles |
|---|---|---|
| **Settings Root & Nav** | Route to Account/Business/Earnings sections | all (role-filtered) |
| **Profile** | Name, photo, contact | all |
| **Organization** | Company name, logo, billing email | owner |
| **Payments (Tenant Connect)** | Org Stripe onboarding + company methods | owner (setup), admin/manager-`can_manage_payments` (read-only) |
| **Payouts (Cleaner Connect)** | Cleaner Stripe onboarding | cleaner |
| **Cancellation Policy** | Late-cancel/no-show/reschedule fees | owner/admin (edit), manager-`can_manage_payments` (view) |
| **Team & Permissions (list + editor)** | Manage 15 manager permission flags | owner, admin (manager-`can_manage_cleaners`) |
| **Cleaner Payouts** | Org default + per-cleaner payout % | owner/admin/manager-`can_manage_payments` |
| **Payout Model** | percentage_contractor vs hourly_external (coming) | owner |
| **Business Hours** | Weekly hours + timezone | owner/admin/manager-`can_manage_cleaners` |
| **Security / Notifications** | Placeholders (coming soon) | all |

### J. Analytics
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Analytics** | Trends over date range | admin, manager (`can_view_analytics`) | date range + presets; cleaner/property filters; booking trends + revenue growth charts; KPIs (bookings, revenue, avg value, utilization) | pick range, filter, view charts, export CSV/PDF |

### K. Platform Owner Back-Office (separate app)
| Surface | Purpose | Roles | Key data | Primary actions |
|---|---|---|---|---|
| **Platform Overview** | Monitor all tenants | platform_admin | 4 stat cards (tenants/active/trialing/payments-ready); tenant list (counts, subscription + Stripe status) | open tenant, provision, refresh, sign out |
| **Platform Org Detail** | Manage one tenant | platform_admin | org header + status; tabs Overview/Team/Financials/Settings | View As, Stripe reset, delete org, back |
| **ProvisionTenantModal** | Onboard new cleaning company | platform_admin | new org fields | provision |
| **ImpersonationBanner** | Indicate View As mode | platform_admin | tenant name | exit |
| **Billing Add-Card (public token link)** | Unauthenticated card capture via link | homeowner (token-scoped) | greeting, PaymentElement, status | enter card, save, success/error |

### L. App Shell / Navigation (see Section 5 for full raw model)
DesktopSidebar, TopBar, MobileNavigation (bottom), MobileSidebar (drawer), MobileTopBar, NotificationBell, ScrollAwareFab / NewBookingButton / ScrollAwareRequestFab, WorkspaceErrorScreen.

---

## 3. Shared vs role-specific

### Genuinely the same job across roles — strong reuse candidates (one component, role-driven variants)

| Component | Shared core | Role-driven variants |
|---|---|---|
| **AppointmentCard / CompactRow** | Render an appointment summary, open detail | Cleaner keeps legacy vertical layout + Start Job + hides price/cleaner; homeowner hides own name; admin/manager show select-mode + inline job progress |
| **Appointment Detail Panel (AppointmentPanelHost / SidePanel)** | View full appt; act on it | Homeowner = read-only; cleaner = confirm/decline/start; admin/manager = reschedule/cancel/assign/card. `canApproveDecline` from permissions (manager) vs always-true (admin) |
| **Messaging (List, Thread, Bubble, Input, NewConversationModal)** | Identical UI for all roles | Only the permission matrix differs (admins/managers ↔ anyone; cleaners/homeowners ↔ admin/manager only). No visual per-role differences |
| **PropertiesPage / PropertyCard / PropertySidePanel** | Filter/search/view properties | Homeowner read-only; admin/manager full CRUD + photo + owner-attach |
| **ServicesPage / ServiceCard / DetailView** | Browse services + checklists | Homeowner/cleaner read-only (`canManageServices=false`); admin/manager full CRUD |
| **PayoutsSection** | "Show me my payouts" wrapper | `variant=cleaner` (own bank) vs `variant=tenant` (org merchant); used in 3 places |
| **Stripe onboarding embed** | Same iframe pattern (onboarding ↔ payouts table, realtime status, framed container) | Cleaner (`cleaner_profiles`, `/connect/cleaner/*`) vs tenant (`organizations`, `/tenant/connect/*` + drift detection) |
| **StripeStatusHero** | Status banner | Owner gets setup/dashboard CTAs; non-owners get informational copy |
| **PaymentStatusBadge / StatusBadge / InviteStatusBadge** | Consistent status rendering | None — pure presentation, role-agnostic |
| **App shell** (Sidebar, TopBar, MobileNav, MobileSidebar, NotificationBell) | Identical chrome | Differs only by tab inventory, primary action, messages-icon visibility, notification routing, profile-click behavior — all passed as props/role |
| **Dashboard page shell** | Near-identical wrappers | Differ only in data hook (useAdminData/useManagerData/useCleanerData/useHomeownerData) and tab IDs |
| **Add/Detail entity modals** | Form + draft-restore + discard-guard pattern | Entity-specific fields |
| **Finance / PaymentsPage** | Transactions/Payouts/Invoices tabs | Manager gated by `can_view/manage_payments`; otherwise identical to admin |
| **JobPhotoLightbox** | View job photos | Cleaner captures; admin/manager/homeowner view read-only |

### Admin ≡ Manager (same surfaces, permission-filtered)
Overview, Bookings, Customers, Properties, Services, Cleaner Management, Team Members, Invites, Finance, Messages, Analytics, Appointment Detail Panel, all modals. Manager differs only by 15 permission flags gating tab visibility + actions, and a stripped-down Overview hero. **Treat admin and manager as one role with a permission layer, not two designs.**

### Genuinely role-specific (no meaningful cross-role reuse)
- **ActiveJobPage + photo/checklist workflow** — cleaner only (others view read-only output).
- **Cleaner Earnings / awaiting-payments** — cleaner only.
- **Homeowner Payment Methods + RequestAppointmentModal** — homeowner only (request is the only homeowner content-creation surface).
- **Owner Setup Checklist** — admin/owner only.
- **Platform Owner app** (`/owner`) — platform_admin only; entirely separate chrome.
- **Org self-pay card/bank picker, Cancellation Policy, Payout Model, Business Hours, Org settings** — owner/admin org-configuration surfaces.
- **AssignCleanerModal / RescheduleAppointmentModal / CancelConfirmModal** — admin/manager dispatch only.

---

## 4. Core data objects

The entities the entire UI revolves around, with key states/lifecycles.

### Appointment (central object)
Carries `organization_id`, homeowner, property, service_type, optional checklist, cleaner, scheduled date/time, duration_minutes, special_requests, total price (+override), `series_id` (recurring), `is_self_pay`, `homeowner_initiated`, `cleaner_confirmation_status`, `response_deadline`, `payment_status`, `authorization_status`, `job_progress`.

Three sub-state machines run on one appointment: **status**, **cleaner_confirmation_status**, and **payment_status** (plus job_progress within in_progress).

#### Appointment status state machine
```
            (homeowner request)         (admin direct book / assign)
                    │                              │
                    ▼                              ▼
        ┌──────── pending ──────────────────────────────┐
        │  cleaner_confirmation_status sub-state:        │
        │     awaiting ⇄ rejected   (reschedule re-sends)│
        │     awaiting → approved                        │
        │     awaiting → expired (deadline passed →      │
        │                escalate to admin / auto-fail)  │
        └───────────────┬────────────────────────────────┘
                        │ cleaner accepts OR admin force-assigns after retries
                        ▼
                    confirmed
                        │ cleaner taps "Start Job" (job_progress = not_started)
                        ▼
                   in_progress  ── job_progress: not_started → before_photos
                        │                       → checklist → after_photos → completed
                        │ last photo + checklist → mark complete (triggers charge)
                        ▼
                    completed   (final; payment settled)

   any active state ──(admin soft-cancel)──▶ cancelled  (record kept, visible)
                    cancelled ──(hard-delete)──▶ deleted (DB only, not in UI)
```
- **cleaner_confirmation_status**: `awaiting | approved | rejected` (sub-state of pending; can flip). `rejected` surfaces "Reschedule Required."
- **Soft-cancel vs hard-delete** is admin/manager-only. Soft-cancel may trigger an off-session cancellation/no-show fee (charge-at-cancel).
- Recurring appointments are individual records sharing `series_id`; all share homeowner/cleaner/property/service/price.

#### Payment status state machine
```
   pending ──▶ processing ──▶ paid
   ("awaiting   (ACH debit       (settled; split into
    cleaner")    clearing,        tenant remainder +
                 ~4 biz days)     cleaner % transfers)
       │             │
       │             ├──▶ failed   (charge declined / ACH return)
       │             │
       └─────────────┴──▶ refunded (full/partial reversal)

   unpaid  = no charge attempted yet (display state)
```
- **Legacy charge flow** (still prod default behind flags): card *hold at booking*, capture at completion — `authorization_status: none → scheduled → authorizing → requires_action → authorized → captured → canceled → failed`.
- **New charge flow** (`STRIPE_NEW_CHARGE_FLOW_ENABLED`): card *saved at booking, charged at completion*; no hold; cancellation fee = off-session charge. `authorization_status` retained only as a charge-outcome mirror.
- **Self-pay** (`is_self_pay`): org's default method charged instead of homeowner card; cleaner cut grossed-up, 100% to cleaner, no platform fee.
- Charge settles to **platform** balance, then splits via separate transfers (connected→connected forbidden).

### Payout (cleaner)
States: `pending → approved → paid → bank_paid`, with `failed` and `reversed` (clawback from dispute/refund/ACH-return). Legacy flow has admin "approve"; new flow moves approval to a reconciliation sweep. Keyed `cleaner-payout-${appointmentId}` for idempotency.

### Property
`organization_id`, name, address/city/state/zip, beds/baths/sqft, photo (single hero), special_instructions (cleaner notes), access_instructions, `owner_id` (→ customer; nullable for org-owned self-pay). 1 customer : many properties. Lifecycle: created → (attached/detached owner, self-pay) → has appointments → deletable (blocked if in use).

### Customer (homeowner)
Name/email/phone/avatar; derived counts (properties, appointments, total spent, last appt). Created via invite. Delete cascades invite deletion; may be blocked by booking/invoice history (partial-success reporting).

### Service type + Checklist + Line item
Service: name, type tag, base_price, duration_minutes, active, description; org-scoped. Checklist: name, price_adder, scoped to service. Line item: task text, position (drag-reorderable). Price range = base + max(checklist adder). Delete gated by usage (appointment/series counts). Active ⇄ disabled toggle.

### Conversation + Message
Conversation: participants (with roles), last preview, unread_count, optional appointment context. Message: sender/recipient, content, attachments (images), is_read, timestamp. Read on thread open. Permission matrix governs who can start conversations.

### Team member / Cleaner profile
TeamMember: user role (homeowner/cleaner/manager/admin) + org role (owner/admin/manager/cleaner/homeowner). Cleaner profile (`cleaner_id = user_id`): payout %, Stripe Connect status, availability, background-check + insurance flags, rating, jobs completed. Manager: 15 permission flags (all-false by default). Delete cascades org membership + profile + permissions + pending invites; blocked if cleaner has active appointments.

### Invite (state machine)
```
pending ──▶ accepted        (successful onboarding)
   │
   ├──▶ expired             (link unused past expiry; lazy on opened_at)
   ├──▶ failed              (email send failed)
   └──▶ superseded          (newer invite for same email/org)
   (transient: creating)
```
Resendable if pending/failed/expired and not superseded. Verify-OTP must fire on explicit button click (M365 Safe Links prefetch otherwise consumes the link).

### Notification (event + outbox)
Event types: homeowner_request_submitted, cleaner_assigned/accepted/declined/counter_proposed/response_overdue, chain_exhausted, job_started/completed, cleaner_paid, dispute_opened, authorization_failed, charge_failed (+ more). Payload denormalized at emit (names, dates, amounts, org_name for self-pay) for offline rendering. Unread = `in_app_dispatched_at IS NULL`. Grouped by appointment. Inline actions: accept counter time, assign cleaner. Tab routing differs per role. Toast dedup via shared module-scoped Set.

### Organization (tenant)
Name, logo, billing email, subscription status, Stripe Connect status (`chargesEnabled/payoutsEnabled/detailsSubmitted/requirementsDue`, drift events), default payment method, cancellation policy, payout model, business hours/timezone, default cleaner payout %. The platform-owner back-office is the org's lifecycle manager (provision → active → reset/delete).

---

## 5. Current navigation model (raw input — to be reorganized, NOT preserved)

### Destinations per role (tab inventory, persisted via `?tab=`)
| Role | Tabs |
|---|---|
| **Admin / Manager** | home, bookings, messages, customers, services, properties, team, cleaners, invites, payments, analytics (11; manager subset gated by permissions) |
| **Cleaner** | home, jobs, messages, earnings, services (5) |
| **Homeowner** | home, messages, services, properties, payments, payment-methods (6) |
| **Platform admin** | `/owner` — no dashboard tabs; custom overview + org-detail drill |

### Desktop
- **DesktopSidebar** (260px, `md:hidden` below): logo, role-specific flat tab list (admin nav is flat, no secondary nav), optional badge counts, profile card (admin/manager → click navigates to /settings; homeowner/cleaner → dropdown), Log Out.
- **TopBar** (fixed, sidebar-aware left padding): centered tab list + active label, NotificationBell (unread badge), Messages icon (homeowner/cleaner/manager only; admin has it as a tab), Settings gear (admin/manager), profile dropdown, primary action button.

### Mobile
- **MobileNavigation** (bottom, 4 visible tabs + Menu slot; sliding pill; capped at 4, no horizontal scroll).
- **MobileSidebar** (full-screen drawer): profile hero, all tabs, swipe-right/Escape/X to close, scroll-lock, Log Out.
- **MobileTopBar**: menu icon + active label + NotificationBell; safe-area aware; hides white bar when notification sheet open (iOS tint).

### Primary action / FAB
- Admin/Manager: **NewBookingButton** wrapping **ScrollAwareFab** (collapses on scroll-down, expands on scroll-up).
- Homeowner: **ScrollAwareRequestFab** ("Request Cleaning").
- Cleaner: none. Desktop primary action lives in TopBar.

### Notifications
- **NotificationBell**: dropdown (desktop, right-anchored) vs bottom sheet (mobile, swipe-down). Grouped by appointment, unread badge (0–99+), mark-all-read, inline accept-time / assign-cleaner, expand multi-update groups. Realtime INSERT/UPDATE. Click → deep-link to appointment + tab (route per event × role). Suppressed during impersonation.

### Notable current-nav observations (candidates to rethink)
- Admin Messages is a **tab**, but for other roles it's a **TopBar icon** — inconsistent placement.
- Mobile bottom nav forces a hard 4-tab cap; admin's 11 tabs overflow into the drawer (Overview, Bookings, Messages, Customers visible; rest hidden).
- "Settings" is a separate route tree (`/settings/*`) with its own rail/menu, parallel to the dashboard `?tab=` model.

---

## 6. Mobile vs desktop functional patterns

Recurring functional adaptations observed across every domain:

| Pattern | Desktop | Mobile |
|---|---|---|
| **Detail view** | Right-side slide-over panel (≈330–600px) | Full-screen sheet (portaled past backdrop-filter), back arrow / X |
| **Primary nav** | Persistent left sidebar (260px) + TopBar tabs | Bottom nav (4 tabs + Menu) + drawer for overflow |
| **Primary action** | TopBar button | ScrollAwareFab (collapses on scroll-down) |
| **Notifications** | Right-anchored dropdown (outside-click/Esc close) | Bottom sheet (swipe-down to dismiss, safe-area aware) |
| **List ⇄ Calendar** | Both views available (calendar grid w/ cleaner columns) | List only; calendar hidden or touch-constrained |
| **Multi-select / bulk** | Sidebar/footer bulk-action bar | Left-slide drawer / long-press affordance |
| **Messaging layout** | Split pane (list left, thread right, both visible) | Mutually exclusive: list → full-screen thread (slide-in, back returns) |
| **Modals / forms** | Centered modal (fixed max-width) | Full-screen sheet; form fields stack |
| **Multi-step modal (e.g. AddAppointment step 1)** | Both panels inline (`sm:block`) | Splits into sub-screens (homeowner picker → property picker) |
| **Filters/search** | Inline single row | Search on own line; filters in dropdowns / horizontal-scroll row |
| **Card layout** | 2–3 col grid or table rows; horizontal 12-col appt grid | Single-column vertical card stack; compact one-line rows |
| **Section sizing** | Larger hero, expanded sections, KPI tiles 4-wide | Compact hero, collapsible sections (header = toggle), KPI 2×2 |
| **Stat tiles** | 4-column | 2×2 grid |
| **Photo capture** | File picker, 3-col grid, keyboard lightbox nav | Camera (`capture=environment`), 2-col grid, swipe lightbox |
| **Stripe embeds** | Framed card prevents layout shift; iframe responsive | Same iframe, full viewport width |
| **Settings** | Persistent left rail + section page | `/settings` = full-screen menu list; `/settings/[section]` = page + back arrow |
| **Button order** | Action-right, Cancel-left | `flex-col-reverse` (Cancel below action) |

Cross-cutting behaviors (both platforms): URL-driven reopenable modals (`?modal=`, `?appointment=`, `?service=`, `?checklists=`) restore state on reload; sessionStorage draft auto-restore (create-only, ~6h TTL) + discard guard on dirty dismiss; realtime patch/invalidate/append via one shared sync helper; TanStack Query org-scoped keys.

---

## 7. Open questions / gaps for the redesign (need a product decision before designing)

### Surface duplication & inconsistency
1. **Messages placement is inconsistent** — a tab for admin, a TopBar icon for everyone else. Pick one model across all roles.
2. **Two parallel navigation systems** — dashboard `?tab=` vs `/settings/*` route tree (each with its own rail/menu). Should settings be a tab, a route, or a panel? Decide one IA.
3. **Appointment detail exists as both a card-opened panel and a notification deep-link target** — confirm one canonical detail surface with a by-id fallback (already partially done) and unify mobile sheet vs deep-link bottom-sheet behavior.
4. **PayoutsSection renders in 3 places** (settings/payouts, settings/payments, cleaner Earnings tab) — confirm whether "earnings" and "payouts settings" should remain separate destinations or merge.
5. **Cleaner Earnings vs Settings → Payouts** overlap (both show balance + onboarding). Likewise **Finance: Payouts tab vs Settings → Cleaner payouts** (status vs configuration). Clarify "view money state" vs "configure money rules" as distinct surfaces.

### Role overlaps & boundaries
6. **Admin vs Manager are effectively one design + permission layer** — confirm we build a single permissioned dashboard rather than two, and decide how "Access Denied" / hidden-tab states should feel.
7. **Team Members vs Cleaner Management overlap** — both list people, both allow add/delete; cleaners are a subset of team members but get payout/verification/Stripe extras. Decide: one unified "People" surface with role facets, or keep separate?
8. **Owner vs Admin org-config split** — Organization settings + Payout Model are owner-only; many others are admin+manager-with-permission. The owner is also "an admin." Clarify the owner tier's distinct surface set.
9. **Platform Owner is a separate app** (`/owner`, no shared chrome) but uses shared dashboards via "View As" impersonation. Decide how much of the redesign applies to the platform back-office vs only tenant dashboards.

### Missing / deferred flows that affect IA
10. **Invoicing** — UI tabs exist (draft/sent/paid/cancelled) but create/send/pay workflow is TBD. Is invoicing in scope, and where does "create invoice" live?
11. **Disputes UI** — dispute_opened events fire and clawbacks exist, but there is no surface to view/manage disputes. Needs a home (likely Payments Needing Attention or Finance).
12. **Security & Notifications settings** are placeholders ("coming soon"). Decide whether to design empty-but-present, or omit until built.
13. **ACH microdeposit verification** — framework exists, deferred. Does the redesign reserve space for a verification step in card/bank flows?
14. **Two charge flows coexist** (legacy hold-at-booking vs new save-at-booking-charge-at-completion) behind flags. The UI must not assume one. Decide whether the redesign targets the new flow only (and how to represent `authorization_status` as a mirror) or must render both.
15. **Self-pay vs homeowner-pay** changes payer, fee math, badges, and which card picker appears. Confirm this is a first-class mode the new appointment/payment surfaces must express, not a bolt-on.

### Triage & action-center scope
16. **Action Required / Action Center** is the admin/manager center of gravity but the queue taxonomy (awaiting_assignment, all_cleaners_declined, cleaner_declined, cleaner_overdue, counter_proposed) was noted as possibly under-broad. Decide the full set of "needs a human" cases and whether payment failures (Payments Needing Attention) should fold into the same unified queue.
17. **KPI fallback logic** — manager revenue tile falls back to "Unassigned count" when `can_view_payments` is off. Confirm the per-permission KPI matrix so tiles are designed for all visibility combinations.

### Navigation capacity
18. **Mobile 4-tab cap vs admin's 11 destinations** — most admin tabs live in the drawer today. The redesign needs an explicit decision on mobile information architecture for the high-tab-count admin/manager role (e.g., consolidate tabs, contextual nav, or a different primary set).
