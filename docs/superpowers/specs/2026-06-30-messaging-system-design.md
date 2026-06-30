# Messaging system design (office shared inbox + per-appointment cleaner threads)

> Status: **design approved (2026-06-30)**. Decomposes into 4 sub-projects, each shipping its own plan + PR. Builds on the job-messaging backend (PR #109, migration 098) and the homeowner Messages tab (PR #110).

## 1. Why

The redesign exposed two gaps in messaging:

1. The homeowner "office" thread is a **private 1:1 with one resolved staff member** (owner -> admin -> manager), dressed up as "Cleaning office." Only that person sees it. The intended model is a **shared office inbox**: the customer messages "the office" and **any admin/manager** can see and answer.
2. Homeowner<->cleaner per-appointment messaging exists but is only reachable from a cleaning's detail screen. There is no **"New conversation"** entry in the Messages tab, and the **cleaner app** has no per-appointment homeowner thread yet, and the **operator** has no read-only view of those threads yet.

This spec defines the whole messaging system so the remaining pieces are built coherently rather than bolted on.

## 2. Verified current state (do not re-derive)

- **`conversations`**: 2-party (`participant_1_id`/`participant_2_id`, both FK -> `user_profiles`). `appointment_id` added by migration 098 (NULL = office thread, NON-NULL = a per-appointment homeowner<->cleaner "job" thread). Two partial uniques (098): one office thread per pair, one job thread per `(appointment_id, pair)`. **`conversations` has NO `organization_id` column.**
- **`conversations_select` RLS** (migration 076): participant-1/2 OR platform-admin only. **No org-staff read** -> a non-participant admin/manager cannot list/open a conversation row.
- **`messages` RLS** (migration 089): `messages_select` AND `messages_insert` both allow `is_admin_or_manager_in_org(organization_id)`. So **org staff can already read AND post messages in any org conversation** (posting as themselves, `sender_id = self`). This is the lever the shared office inbox uses.
- **`isJobMessagingWindowOpen(appt, now)`** (`src/lib/messaging/jobMessagingWindow.ts`): open while `in_progress`, while `confirmed` AND `cleaner_confirmation_status='approved'`, and for 24h after `completed_at`; closed when cancelled/pending/awaiting/past-grace.
- **Org kill-switch** `organizations.homeowner_cleaner_messaging_enabled` (098, default true) gates homeowner<->cleaner messaging.
- **Office contact resolution**: `resolvePrimaryOfficeContact(members)` (owner -> admin -> manager) in `src/components/redesign/cleaner/messages/office-contacts.ts`.
- **Operator Messages console** (`OperatorMessages.tsx`) uses `useConversations({ userId })` = **participant-scoped** (each staff member sees only their own conversations).
- **Homeowner Messages tab** (PR #110): sectioned inbox (office threads + active/Past job threads); office thread relabeled "Cleaning office"; job sends route through the guarded `POST /api/appointments/[id]/messages`; `useConversations`/`useUnreadMessageCount` carry a `scope` param (`office`/`job`/`all`).
- **Cleaner app**: office-only messaging (`CleanerMessages`, named office contacts). No per-appointment homeowner threads yet.

## 3. The model: two channels

1. **Customer <-> Office (shared team inbox).** One canonical office thread per customer. The customer sees "Cleaning office." Any admin/manager in the org can read and reply; replies are attributed to whoever answered on the operator side. Applies to both homeowner<->office and cleaner<->office (the office is one team for everyone).
2. **Homeowner <-> Cleaner (per-appointment, direct).** Already built. Scoped to one appointment, window-gated (open from confirmed+cleaner-accepted through 24h after completion), the cleaner's name/face shown. The office views these **read-only** (never posts into them).

## 4. Architecture decision: shared office inbox

**Chosen: Approach A - canonical office thread + org-scoped reads** (over Approach B, a dedicated office-conversation entity that would ripple through every conversation query + RLS policy for little gain).

- Add **`conversations.organization_id`** (nullable FK -> organizations, backfilled, indexed). For office threads it is the customer's org; for job threads it equals the appointment's org. This makes the org-staff RLS policy and the operator's org-scoped query simple and cheap.
- Add a **`conversations` org-staff SELECT policy** scoped to office threads: `appointment_id IS NULL AND organization_id IS NOT NULL AND is_admin_or_manager_in_org(organization_id)`. (Job threads deliberately get **no** conversations org-staff policy; the operator reads job *messages* via the existing `messages` org-staff policy + `appointment_id`, exactly as the job-messaging brief decided.)
- **One canonical office thread per customer.** "Message office" always resolves to the same canonical office contact (`resolvePrimaryOfficeContact`), so the unique-office index yields one thread. A one-time **consolidation** merges any pre-existing duplicate office threads for a customer (re-point their messages to the canonical thread, drop the empties) so the homeowner shows a single "Cleaning office" row and the team sees one thread. The homeowner office section renders the **one canonical** office thread (not the all-threads list shipped in #110).
- **Team awareness without changing recipient semantics.** A customer's office message keeps `recipient_id` = the canonical contact (so existing unread logic is untouched). Team awareness comes from a new **`office_message` notification** fanned out to all org admins/managers, plus the **org-scoped operator console** surfacing the thread. We do NOT rework per-user unread/recipient semantics.
- Staff replies use the existing `messages_insert` org-staff path (`sender_id = self`, `recipient_id` = the customer). No RLS change needed for replies.

**Edge case (documented, accepted):** if the canonical office contact later leaves the org, "Message office" resolves to a new contact and a new canonical thread forms; the old thread stays readable. Re-consolidation is out of scope (rare; ops can handle).

## 5. Surfaces

### 5.1 Homeowner Messages tab
- **Cleaning office** (one shared, team-answered thread) pinned at top. Shows one canonical office row (replacing #110's all-office-threads list).
- **Your cleanings** - active per-appointment cleaner threads (direct, cleaner name/face, window-gated). Unchanged from #110.
- **Past** - read-only closed threads. Unchanged.
- **"New conversation"** action: choose **Office** (open the shared office thread) or **a cleaning** -> a picker listing only appointments **whose messaging window is open right now** -> opens that cleaner's per-appointment thread. **No free cleaner picker**; cleaners are reachable only via an appointment. (This is an additional entry point; the cleaning-detail "Message about this cleaning" stays.)

### 5.2 Operator Messages console (the major rework)
- Becomes **org-scoped** for admins/managers (gated by `is_admin_or_manager_in_org`): shows the org's **office threads** (shared inbox) - any admin/manager can open and reply to any; replies attributed to whoever answered.
- Also lists **read-only** homeowner<->cleaner **job threads**, clearly labeled "[Homeowner] and [Cleaner] . [date]", view-only (no composer; the office never posts into a job thread).
- Office vs job and replyable vs read-only are visually distinct. Existing search/role-filter UX adapts to the org-scoped set.

### 5.3 Operator booking/appointment detail
- A read-only **"Messages on this job"** panel (reads `messages` by `appointment_id` via the org-staff `messages` policy; no conversations policy needed). Shows the homeowner<->cleaner thread for that appointment, view-only.

### 5.4 Cleaner app
- Per-appointment **"Message homeowner"** from the active job + a Messages section showing those threads (the cleaner side of the existing homeowner job threads; same window gating, same guarded send route). Sends route through the guarded route (the cleaner is a current participant; RLS backstop applies).
- Cleaner<->office uses the **same shared-team office model** (the cleaner messages "the office"; the team sees it).

### 5.5 Notifications
- New **`office_message`** event: when a customer (homeowner or cleaner) messages the office, fan out to the org's admins/managers (reuses the `notification_events` outbox + a `describeNotification` descriptor). Today office threads have no notification.
- Existing `job_message` notification (customer<->cleaner) unchanged.

## 6. Backend summary
- **Migration**: `conversations.organization_id` (nullable FK, backfilled from participants/appointment, indexed); org-staff office-thread SELECT policy on `conversations`; one-time office-thread consolidation per customer. (Job-thread office-read still via `messages` policy; no new conversations job policy.)
- **No change** to `messages` RLS (org staff already read+write).
- `office_message` notification emit (server-side, from the office send path) + descriptor.
- The guarded job send route + window gating + kill-switch are reused as-is.

## 7. Decomposition (4 sub-projects; each its own plan + PR)

Recommended order **1 -> 2 -> 3 -> 4** (foundation first; the operator console is shared by 1 and 2; 3 and 4 are independent and may move earlier for a quick win). Merges are user-gated.

1. **Shared office inbox** - migration (`conversations.organization_id` + backfill + org-staff office RLS + consolidation), the `office_message` notification, the **org-scoped operator Messages console** (office threads, team-replyable), and the homeowner office section showing the single canonical thread. *Depends on: nothing new.*
2. **Operator read-only job threads** - read-only job-thread entries in the operator Messages console + the booking-detail "Messages on this job" panel. *Depends on: #1's org-scoped console.* (Replaces the old "PR4".)
3. **Homeowner "New conversation" flow** - the Messages-tab entry (office + window-open appointment picker). *Independent; small; builds on #110.*
4. **Cleaner app messaging** - per-appointment "Message homeowner" + cleaner Messages threads + cleaner<->office shared model. *Independent of 1-3 on the cleaner side; reuses the shared-office model from #1 for cleaner<->office.* (Replaces the old "PR3".)

## 8. Non-goals / out of scope
- Reworking per-user unread/recipient semantics (team awareness is via notification + org-scoped console).
- Re-consolidating office threads after a canonical contact leaves (rare; ops-handled).
- Customer-to-arbitrary-person messaging (cleaners reachable only via an appointment; office only as a team).
- SMS/email dispatch of the new notifications (outbox is written; dispatcher is a separate effort).
- Attachments on job/office threads beyond what exists today (job sends remain text-only per the guarded route).

## 9. Testing approach
- **Unit**: pure derivations (inbox sectioning incl. the single canonical office row; the "messageable appointments" picker filter using `isJobMessagingWindowOpen`).
- **Integration** (against local Supabase): the migration (org_id backfill + consolidation rebuilds cleanly via `db reset`); the org-staff office RLS (an admin/manager who is NOT a participant CAN read an org office thread but NOT another org's; a non-staff user cannot); office-thread send + `office_message` notification fan-out; job-thread read-only for operators (read yes, the route still blocks office posting into a job thread).
- **Visual**: homeowner Messages (single office row + New-conversation picker), operator console (shared office + read-only job threads), booking panel, cleaner app - verified on the preview / local dev with screenshots (user is on mobile).

## 10. Global constraints (inherited by every sub-project plan)
- Design system only (`src/components/ui/*` + tokens); brand `#0150FC`; no raw hex; **no `primary-<number>`** (legacy yellow); semantic shades `-50`/`-700` (no `critical-600`).
- **No em dashes** in user-facing copy. **"Office" not "operator"** in customer-facing copy.
- Never import `lib/supabase-admin` from client code. New API routes get co-located `*.integration.test.ts`. New pure logic gets `*.test.ts`.
- Flag-gated `(redesign)` route group; legacy untouched until cutover. Migrations are immutable once shipped; never push migrations directly to prod.
