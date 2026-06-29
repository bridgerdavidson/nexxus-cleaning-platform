# Job messaging (homeowner ↔ cleaner) — design brief

> Status: **design captured, OPEN POINTS remain** (resolve in a dedicated brainstorm before writing the plan). Extracted from the Homeowner redesign spec (`2026-06-29-redesign-homeowner-app-design.md`) on 2026-06-29 because it is a cross-cutting, backend-bearing feature, not a homeowner screen.
> Cross-cutting scope: **homeowner Messages tab** (consumer) + **cleaner-app Messages** (today office-only — needs a companion update) + **operator office read-only** + **DB migrations** + **send-gating route**. The homeowner Messages slice consumes this; build this around/before that slice.

## 1. Why

Stakeholders originally wanted homeowner↔operator and cleaner↔operator only (no direct homeowner↔cleaner). This adds a **tightly-scoped** direct channel for real coordination (cleaner running late, homeowner pre-job info) **without** opening arbitrary contact.

## 2. Decided model (locked in brainstorm 2026-06-29)

- **A thread is a property of an appointment, not a contact.** It exists only because a specific homeowner + assigned cleaner share that job, so arbitrary contact is impossible by construction — there is **no compose-to-a-person picker** for either side.
- **Lifecycle (send window):** send-enabled from **cleaner-assigned** until **completed + a short grace window (~24h)**; a **cancelled** appointment closes immediately. After the window the thread is **archived read-only** (sending disabled, history preserved) — never deleted. Temporary *access*, permanent *record*.
- **Visibility:** homeowner + assigned cleaner + **office (org staff, read-only)**. The parties know it is not fully private — supports oversight, dispute resolution, and discourages off-platform poaching.
- **Org kill-switch:** per-org toggle `organizations.homeowner_cleaner_messaging_enabled` (**default `true`** / opt-out), in operator Settings → "Cleaner experience" (owner/admin), reusing the `/api/organizations/[orgId]/cleaner-experience` route + `CleanerExperienceSection`. When **off**: entry points don't render, the send route rejects (server-enforced), no new threads are created, existing threads go read-only with history retained. **Messaging only** — Office threads + homeowner live-tracking are unaffected.
- **PII minimization:** first names + in-app only; no phone/email exchanged.
- **Quick presets** on top of free text: cleaner "On my way" / "Running ~15 min late"; homeowner pre-job "access & notes".
- **Entry points:** homeowner from the cleaning (Home hero / Cleanings detail "Message about this cleaning") while active; cleaner from the job (cleaner-app companion update).

## 3. Verified backend reality (from spec-review investigation, 2026-06-29)

- **`messages` already has `appointment_id`** (nullable, FK→appointments, PR #88) and `useSendMessage({ appointmentId })` already passes it. **`conversations` does NOT** have `appointment_id` (pure user-pair: `participant_1_id`/`participant_2_id` + `different_participants` CHECK).
- **`get_or_create_conversation(user1,user2)` keys ONLY on the ordered participant pair** → two appointments with the same homeowner+cleaner (and **every recurring-series instance**) collide into one conversation. **This is the core rework**: a new appointment-aware get-or-create + a uniqueness constraint that includes `appointment_id`.
- **RLS today:** `conversations_select` = participant-1/2 OR platform-admin (NO org-staff read). `messages_select` **already** allows org admin/manager read via `is_admin_or_manager_in_org(messages.organization_id)` + participant + platform-admin. So the office can already read job *messages* (messages carry `organization_id NOT NULL`) but **cannot list/open the conversation row** without a new policy.
- **Send-gating cannot be RLS-only:** `messages_insert` is permissive (sender + `can_message_user`, plus managers can insert). A **dedicated guarded send route** must enforce: appointment in active window + org flag on + sender is the *current* homeowner/assigned cleaner. RLS is a backstop, not the gate.
- **Appointment lifecycle for the window:** `appointment_status` = `pending|confirmed|in_progress|completed|cancelled`. Assignment sets `cleaner_id` (+ force-assign → `confirmed`); **reassignment resets `status→'pending'`** until re-confirm (the send window legitimately closes in that gap). `cancelled_at` exists; **there is no `completed_at` / job-start timestamp** (`job_progress` is a bare enum) — so a 24h-after-*completion* grace needs either a new timestamp column or anchoring grace to `scheduled_date/time + 24h`.
- **No message notification exists today** (not even for Office threads) — a `message`/`job_message` notification event would be net-new (`notification_events.event_type` is free-text; emit from the send route via the existing outbox).
- **Client hooks are 2-party-shaped:** `useConversations` derives a single `other_participant`; `deriveOfficeInbox` is built for a contact set. The thread UI (`ChatThread`, scroll/mark-read/realtime) is participant-agnostic and reusable; the **send box** and the **inbox derivation** need the new modes (read-only viewer, appointment-scoped thread, N active threads).

## 4. OPEN decisions (resolve in this feature's brainstorm before its plan)

1. **Reassignment thread model:** one thread per **appointment** (swap the cleaner participant on reassignment — new cleaner then sees prior messages) vs one thread per **(appointment, cleaner) stint** (reassignment archives the old thread, opens a fresh one). *Leaning: per-stint — cleaner semantics, no participant mutation, old cleaner keeps their own read-only history.*
2. **Office-read surface:** does the office consume job threads via the existing operator Messages appointment-link (`messages.appointment_id`, no conversations policy change) or via a new `conversations` org-staff read policy (so job threads appear in the operator inbox)? Decide the operator UX.
3. **Grace mechanism:** add `started_at`/`completed_at` timestamp columns (also unlocks "elapsed time" if wanted) vs anchor grace to `scheduled_date/time + 24h` (no schema change). 
4. **Notification:** event name (`job_message`?), and whether **standing Office threads** also begin notifying (scope expansion) or only job threads.
5. **Mixed-inbox derivation:** how the homeowner inbox presents one persistent Office thread + **N** appointment-scoped threads (multiple active cleanings / properties / recurring) — extend or replace `deriveOfficeInbox`.
6. **Kill-switch placement/label:** under "Cleaner experience" vs a new "Communication" subsection.

## 5. Likely backend shape (to confirm in the plan)
- Migration: `conversations.appointment_id` (nullable, FK cascade, index) + appointment-aware get-or-create + uniqueness; `organizations.homeowner_cleaner_messaging_enabled boolean NOT NULL DEFAULT true`; org-staff read policy if the office consumes conversations directly; (optionally) `started_at`/`completed_at` on appointments for grace.
- Guarded **send route** enforcing window + org flag + current participant; emits the message notification.
- Client: extend `useMessages`/inbox for appointment-scoped + read-only + multi-thread; cleaner-app Messages companion update; homeowner Messages consumption.

## 6. Tests
Send-gating (blocked after complete+grace, on cancel, when org flag off, by non-current-participant); RLS negatives (non-participant / non-org-staff cannot read); reassignment access (old cleaner read-only, new cleaner active); recurring series → distinct threads; org-staff read scoped to own org.
