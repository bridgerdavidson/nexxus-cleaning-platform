# Job Messaging — Backend Foundation (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the cross-cutting backend that lets a homeowner and the assigned cleaner exchange messages scoped to a single cleaning, gated by a window + per-org kill-switch + current-participant check, with a `job_message` notification — no consumer UI yet beyond the operator settings toggle.

**Architecture:** A conversation becomes optionally appointment-scoped (a *job thread* = the homeowner+cleaner pair + one appointment; *office threads* keep `appointment_id IS NULL`). Because `can_message_role` forbids homeowner↔cleaner, a job message **cannot** be inserted by the client under RLS; instead a guarded server route (`POST /api/appointments/[appointmentId]/messages`) authenticates the caller, enforces the gate, and writes via the **service-role admin client** (RLS stays the backstop that keeps the channel closed except through the route). A server-only `get_or_create_job_conversation` SQL function resolves/creates the per-appointment conversation. The counterparty gets a best-effort `job_message` notification through the existing outbox.

**Tech Stack:** Next.js 16 App Router (Node runtime route handlers), Supabase Postgres + RLS + service-role admin client (`@/lib/supabase-admin`), Vitest 3 (unit + integration against local Supabase), existing notification outbox (`recordNotificationEvent` / `loadNotificationContext`).

## Global Constraints

- **Migrations are immutable once shipped + idempotent.** New file `supabase/migrations/098_job_messaging.sql` (098 is the next number; 097 is the highest today). Use `IF NOT EXISTS` / `DROP ... IF EXISTS` / `CREATE OR REPLACE` so `npx supabase db reset` and `Migrate / migrate-dev` rebuild cleanly. Never edit a shipped migration.
- **No em dashes (`—`) in any user-facing copy** (error strings, notification titles/snippets, settings labels). Use a period, comma, parentheses, or "to".
- **Server-only secrets:** never import `@/lib/supabase-admin` from client code. The route is server-only.
- **Design system only** for the one UI change (the settings toggle): reuse `src/components/ui/*` primitives (`Switch`, `SettingRow`) exactly like the existing rows. No raw hex, no `primary-*` (legacy yellow).
- **Branch off current master:** `git checkout master; git pull origin master; git checkout -b feat/job-messaging-backend`.
- **Gates before push:** `npm run test`, `npx tsc --noEmit`, `npm run lint`, and `npx supabase db reset` (migration slice). Integration tests need local Supabase up (`npx supabase start`, Docker) + `.env.test.local`. The full integration suite flakes locally on parallel GoTrue auth: run the touched files in isolation; CI runs the full suite. One `/codex:review --scope branch --base master --wait` before push (user-triggered), apply valid fixes, then PR to master.

## Verified backend reality (grounding for every task)

All confirmed against the live dev DB + current migrations on 2026-06-30:

- `messages` columns: `id, sender_id, recipient_id, appointment_id (nullable), subject, content, is_read, created_at, organization_id (NOT NULL), conversation_id`. No `message_type`, no `body` (it is `content`), attachments live in `message_attachments`.
- `conversations` columns: `id, participant_1_id, participant_2_id, last_message_at, created_at`. FKs → `user_profiles(id)`. Constraint `unique_conversation UNIQUE(participant_1_id, participant_2_id)` + `different_participants CHECK`. **No `appointment_id`.**
- `get_or_create_conversation(user1,user2)` (migration 089) keys only on the ordered pair and calls `can_message_user` → it **rejects homeowner↔cleaner** and would collide every recurring instance. Do **not** reuse it for job threads.
- `can_message_role`: `homeowner → (admin,manager)`, `cleaner → (admin,manager)` only. **homeowner↔cleaner is RLS-blocked** → job message inserts must use the admin client.
- RLS: `conversations_select` = participants OR platform-admin (no org-staff read). `messages_select` = sender OR recipient OR `is_admin_or_manager_in_org(organization_id)` OR conversation-participant OR platform-admin (so **org staff already read job messages by org**, no new conversations policy needed). `messages_insert` is permissive but blocked for homeowner↔cleaner by `can_message_user`.
- `appointments`: has `homeowner_id (nullable)`, `cleaner_id (nullable)`, `status` (`pending|confirmed|in_progress|completed|cancelled`), `started_at`, `completed_at`, `cancelled_at`, `organization_id (NOT NULL)`.
- `organizations`: cleaner-experience already manages `cleaner_pay_display` + `require_job_photos`. **No** messaging flag yet.
- `notification_events`: append-only outbox; `event_type` is free text (no enum) → `job_message` needs no DB enum change; emit via `recordNotificationEvent`.
- `messages` has an `AFTER INSERT` trigger `update_conversation_timestamp → update_conversation_last_message()` → the route does **not** write `last_message_at`.
- `conversations` + `messages` are already `REPLICA IDENTITY FULL` and in the `supabase_realtime` publication → **no realtime migration** for the new column.

---

## File Structure

- **Create** `supabase/migrations/098_job_messaging.sql` — `conversations.appointment_id`, two partial unique indexes (office vs job), org kill-switch column, server-only `get_or_create_job_conversation`.
- **Create** `src/lib/messaging/jobMessagingWindow.ts` — pure `isJobMessagingWindowOpen(appt, now)` (reused by the route now + the client UI later).
- **Create** `src/lib/messaging/jobMessagingWindow.test.ts` — unit test for the window matrix.
- **Create** `src/app/api/appointments/[appointmentId]/messages/route.ts` — the guarded `POST` send route.
- **Create** `src/app/api/appointments/[appointmentId]/messages/route.integration.test.ts` — the gating + thread + RLS matrix.
- **Modify** `src/lib/notifications/eventTypes.ts` — add `'job_message'` to the `NotificationEventType` union.
- **Modify** `src/lib/notifications/labels.ts` — add `'job_message'` to `KNOWN_TYPES` + a `build()` case + import `MessageSquare`.
- **Modify** `src/app/api/organizations/[orgId]/cleaner-experience/route.ts` — accept/validate/update `homeowner_cleaner_messaging_enabled`.
- **Modify** `src/components/redesign/settings/sections/CleanerExperienceSection.tsx` — add the messaging toggle row.
- **Extend (already exists)** `src/app/api/organizations/[orgId]/cleaner-experience/route.integration.test.ts` — add two cases: the new flag persists + cleaner is gated.

No change to `deriveNotifications.ts` / `navigation.ts` in PR1: a `job_message` row carries `appointment_id`, so it already deep-links per role (homeowner `?appointment=`, cleaner `?job=`). Refining the target to open the thread directly is a PR2/PR3 follow-up (the consuming Messages UI does not exist yet).

---

## Task 1: Migration 098 (schema + server-only job get-or-create)

**Files:**
- Create: `supabase/migrations/098_job_messaging.sql`

**Interfaces:**
- Produces: `conversations.appointment_id uuid NULL`; indexes `unique_office_conversation`, `unique_job_conversation`, `idx_conversations_appointment`; `organizations.homeowner_cleaner_messaging_enabled boolean NOT NULL DEFAULT true`; SQL function `get_or_create_job_conversation(p_user_a uuid, p_user_b uuid, p_appointment_id uuid) RETURNS uuid` (service_role only).

- [ ] **Step 1: Write the migration**

```sql
-- 098_job_messaging.sql
-- Job messaging (homeowner <-> cleaner). A conversation can now be scoped to an
-- appointment: a job thread = the homeowner+cleaner pair + a specific appointment;
-- office threads keep appointment_id NULL. Adds the per-org kill-switch and a
-- server-only get-or-create for job threads (the existing 2-arg
-- get_or_create_conversation calls can_message_user, which forbids
-- homeowner<->cleaner, so it cannot be reused here).

-- 1. Scope column (a job thread points at its appointment; office threads stay NULL).
alter table public.conversations
  add column if not exists appointment_id uuid
  references public.appointments(id) on delete cascade;

-- 2. Replace the single pair-unique with two PARTIAL uniques. A naive
--    UNIQUE(appointment_id, p1, p2) would let NULL-appointment office threads
--    duplicate, because Postgres treats NULLs as distinct. So: one office thread
--    per pair, one job thread per (appointment, pair).
alter table public.conversations drop constraint if exists unique_conversation;

create unique index if not exists unique_office_conversation
  on public.conversations (participant_1_id, participant_2_id)
  where appointment_id is null;

create unique index if not exists unique_job_conversation
  on public.conversations (appointment_id, participant_1_id, participant_2_id)
  where appointment_id is not null;

create index if not exists idx_conversations_appointment
  on public.conversations (appointment_id)
  where appointment_id is not null;

-- 3. Per-org kill-switch (default on / opt-out), alongside the other
--    "cleaner experience" org settings.
alter table public.organizations
  add column if not exists homeowner_cleaner_messaging_enabled boolean not null default true;

-- 4. Server-only get-or-create for a job conversation. Unlike
--    get_or_create_conversation, this does NOT check auth.uid()/can_message_user:
--    it is invoked only by the trusted guarded send route (service role), which
--    enforces the window + org flag + current-participant gate itself. Locked to
--    service_role so it can never be called from the client.
create or replace function public.get_or_create_job_conversation(
  p_user_a uuid,
  p_user_b uuid,
  p_appointment_id uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  p1 uuid;
  p2 uuid;
begin
  if p_appointment_id is null then
    raise exception 'appointment_id is required' using errcode = '22004';
  end if;

  if p_user_a < p_user_b then
    p1 := p_user_a; p2 := p_user_b;
  else
    p1 := p_user_b; p2 := p_user_a;
  end if;

  select id into v_id
  from public.conversations
  where appointment_id = p_appointment_id
    and participant_1_id = p1
    and participant_2_id = p2;

  if v_id is null then
    insert into public.conversations (participant_1_id, participant_2_id, appointment_id)
    values (p1, p2, p_appointment_id)
    on conflict (appointment_id, participant_1_id, participant_2_id)
      where appointment_id is not null
      do nothing
    returning id into v_id;

    -- Lost an insert race: the row now exists, re-select it.
    if v_id is null then
      select id into v_id
      from public.conversations
      where appointment_id = p_appointment_id
        and participant_1_id = p1
        and participant_2_id = p2;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.get_or_create_job_conversation(uuid, uuid, uuid) from public;
revoke all on function public.get_or_create_job_conversation(uuid, uuid, uuid) from anon;
revoke all on function public.get_or_create_job_conversation(uuid, uuid, uuid) from authenticated;
grant execute on function public.get_or_create_job_conversation(uuid, uuid, uuid) to service_role;
```

- [ ] **Step 2: Rebuild the schema from scratch to verify it applies cleanly**

Run: `npx supabase db reset`
Expected: completes with no error; the run lists `098_job_messaging.sql` among applied migrations. (Requires Docker Desktop + `npx supabase start` stack.)

- [ ] **Step 3: Verify the objects exist**

Run:
```bash
npx supabase db reset >/dev/null 2>&1
psql "$(npx supabase status --output json | npx --yes json5 -e 'JSON.parse(require("fs").readFileSync(0)).DB_URL' 2>/dev/null || echo postgresql://postgres:postgres@127.0.0.1:54322/postgres)" -c "\d+ public.conversations" -c "select proname from pg_proc where proname='get_or_create_job_conversation';"
```
Expected: `conversations` shows `appointment_id`, indexes `unique_office_conversation`, `unique_job_conversation`, `idx_conversations_appointment`; the function is listed. (If `psql` is not convenient, instead verify via the Task 4 integration tests, which exercise every object.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/098_job_messaging.sql
git commit -m "feat(messaging): migration 098 - appointment-scoped conversations + kill-switch + job get-or-create"
```

---

## Task 2: Job-messaging send-window helper (pure + unit-tested)

**Files:**
- Create: `src/lib/messaging/jobMessagingWindow.ts`
- Test: `src/lib/messaging/jobMessagingWindow.test.ts`

**Interfaces:**
- Produces: `isJobMessagingWindowOpen(appt: { status: string; completed_at: string | null; cancelled_at: string | null }, now: Date): boolean`. Consumed by Task 4 (the route) and later by the client composer.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/messaging/jobMessagingWindow.test.ts
import { describe, it, expect } from 'vitest';
import { isJobMessagingWindowOpen } from './jobMessagingWindow';

const now = new Date('2026-06-30T12:00:00Z');
const base = { status: 'confirmed', completed_at: null as string | null, cancelled_at: null as string | null };

describe('isJobMessagingWindowOpen', () => {
  it('open when confirmed', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'confirmed' }, now)).toBe(true);
  });
  it('open when in_progress', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'in_progress' }, now)).toBe(true);
  });
  it('closed when pending (incl. post-reassignment re-confirm gap)', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'pending' }, now)).toBe(false);
  });
  it('closed when status cancelled', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'cancelled' }, now)).toBe(false);
  });
  it('closed when cancelled_at set even though status is confirmed', () => {
    expect(
      isJobMessagingWindowOpen({ status: 'confirmed', completed_at: null, cancelled_at: '2026-06-30T11:00:00Z' }, now),
    ).toBe(false);
  });
  it('open within 24h after completion', () => {
    expect(
      isJobMessagingWindowOpen({ status: 'completed', completed_at: '2026-06-30T01:00:00Z', cancelled_at: null }, now),
    ).toBe(true);
  });
  it('closed after the 24h grace window', () => {
    expect(
      isJobMessagingWindowOpen({ status: 'completed', completed_at: '2026-06-29T11:00:00Z', cancelled_at: null }, now),
    ).toBe(false);
  });
  it('closed when completed without a completed_at timestamp', () => {
    expect(
      isJobMessagingWindowOpen({ status: 'completed', completed_at: null, cancelled_at: null }, now),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/lib/messaging/jobMessagingWindow.test.ts`
Expected: FAIL ("Cannot find module './jobMessagingWindow'").

- [ ] **Step 3: Write the helper**

```ts
// src/lib/messaging/jobMessagingWindow.ts

export interface JobMessagingWindowAppointment {
  status: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the homeowner<->cleaner job thread is open for SENDING.
 *
 * Open while the cleaning is actively engaged (confirmed or in progress) and for
 * a 24h grace window after completion. Closed while pending (including the
 * post-reassignment re-confirm gap), once cancelled, and after the grace window.
 * History stays readable when closed; only sending is gated.
 * (Job-messaging design brief, sections 2 and 3.)
 */
export function isJobMessagingWindowOpen(
  appt: JobMessagingWindowAppointment,
  now: Date,
): boolean {
  if (appt.status === 'cancelled' || appt.cancelled_at) return false;
  if (appt.status === 'confirmed' || appt.status === 'in_progress') return true;
  if (appt.status === 'completed' && appt.completed_at) {
    return now.getTime() < new Date(appt.completed_at).getTime() + GRACE_MS;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/lib/messaging/jobMessagingWindow.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging/jobMessagingWindow.ts src/lib/messaging/jobMessagingWindow.test.ts
git commit -m "feat(messaging): job-messaging send-window helper"
```

---

## Task 3: `job_message` notification type + label

**Files:**
- Modify: `src/lib/notifications/eventTypes.ts` (union, around lines 12-36)
- Modify: `src/lib/notifications/labels.ts` (`KNOWN_TYPES` set, `build()` switch, lucide import)

**Interfaces:**
- Consumes: nothing.
- Produces: `'job_message'` is a valid `NotificationEventType`; `describeNotification('job_message', payload)` returns a real descriptor (not `FALLBACK`) using `payload.sender_name` + `payload.snippet`. Consumed by Task 4 (the route emits it) + the bell/toast renderer.

- [ ] **Step 1: Add `job_message` to the event-type union**

In `src/lib/notifications/eventTypes.ts`, insert a line immediately before the terminating `| 'member_joined';`:

```ts
  | 'clawback_blocked'              // recipient: admins (payout already bank_paid; recovery needs an ops decision)
  | 'job_message'                   // recipient: counterparty (homeowner or cleaner) on a job thread
  | 'member_joined';                // recipient: admins + managers (someone accepted an invite and joined the org)
```

- [ ] **Step 2: Add `job_message` to `KNOWN_TYPES` and a `build()` case in `labels.ts`**

In `src/lib/notifications/labels.ts`:

(a) Add `MessageSquare` to the existing `lucide-react` import (the import block around lines 1-18). Example: `import { ..., MessageSquare, Bell } from 'lucide-react';` (keep the existing icons; just add `MessageSquare`).

(b) Add `'job_message'` to the `KNOWN_TYPES` Set (insert near the related entries):

```ts
  'clawback_blocked',
  'job_message',
  'member_joined',
```

(c) Add a `case` to `build()` (place it next to the other job/* cases, e.g. after `job_completed`):

```ts
    case 'job_message': {
      const sender = str(payload, 'sender_name');
      return {
        title: sender ? `New message from ${sender}` : 'New message',
        detail: str(payload, 'snippet'),
        tone: 'info',
        icon: MessageSquare,
      };
    }
```

- [ ] **Step 3: Write a focused unit test for the descriptor**

Create `src/lib/notifications/labels.jobMessage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { describeNotification } from './labels';

describe('describeNotification - job_message', () => {
  it('uses the sender name and snippet from the payload', () => {
    const d = describeNotification('job_message', { sender_name: 'Maria', snippet: 'On my way' });
    expect(d.title).toBe('New message from Maria');
    expect(d.detail).toBe('On my way');
    expect(d.tone).toBe('info');
  });
  it('falls back to a generic title with no sender name', () => {
    const d = describeNotification('job_message', { snippet: 'Hi' });
    expect(d.title).toBe('New message');
  });
  it('is a known type (not the generic fallback)', () => {
    const d = describeNotification('job_message', {});
    expect(d.title).not.toBe('Update');
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- src/lib/notifications/labels.jobMessage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/eventTypes.ts src/lib/notifications/labels.ts src/lib/notifications/labels.jobMessage.test.ts
git commit -m "feat(messaging): job_message notification type + label"
```

---

## Task 4: Guarded job-message send route

**Files:**
- Create: `src/app/api/appointments/[appointmentId]/messages/route.ts`
- Test: `src/app/api/appointments/[appointmentId]/messages/route.integration.test.ts`

**Interfaces:**
- Consumes: `isJobMessagingWindowOpen` (Task 2); `'job_message'` type + label (Task 3); migration 098's `get_or_create_job_conversation` + `organizations.homeowner_cleaner_messaging_enabled` (Task 1); `verifyAccessToken` (`@/lib/auth/verifyToken`), `recordNotificationEvent` + `loadNotificationContext`, `supabaseAdmin`, `uuidv4` (`@/lib/uuid`).
- Produces: `POST /api/appointments/:appointmentId/messages` with body `{ content: string }`. Status contract: `401` no/invalid token; `404` unknown appointment; `403` caller not a current participant / org flag off / window closed; `409` no counterparty assigned; `400` empty or too-long content; `201` `{ message: {...} }` on success. Inserts one `messages` row (`appointment_id` set, via the per-appointment conversation) and emits one `job_message` notification to the counterparty.

> **TDD note:** integration tests need local Supabase up. Run this file in isolation (`npm run test:integration -- messages/route.integration`) to avoid the parallel-GoTrue flake.

- [ ] **Step 1: Write the failing integration test (full gating + thread + RLS matrix)**

```ts
// src/app/api/appointments/[appointmentId]/messages/route.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';
import { callRoute, bearerHeader } from '../../../../../../tests/helpers/auth';
import {
  withTestOrg,
  createTestAppointment,
  type TestOrgFixture,
} from '../../../../../../tests/helpers/fixtures';
import { createTestSupabaseClient, createUserClient } from '../../../../../../tests/helpers/supabase';

const handlerFor = (appointmentId: string) => (req: NextRequest) =>
  POST(req, { params: Promise.resolve({ appointmentId }) });

const admin = createTestSupabaseClient();

async function jobMessageNotifs(appointmentId: string) {
  const { data } = await admin
    .from('notification_events')
    .select('recipient_user_id, event_type')
    .eq('appointment_id', appointmentId)
    .eq('event_type', 'job_message');
  return (data ?? []) as Array<{ recipient_user_id: string; event_type: string }>;
}

describe('POST /api/appointments/:appointmentId/messages (job messaging)', () => {
  let org: TestOrgFixture;
  let org2: TestOrgFixture;

  beforeEach(async () => {
    [org, org2] = await Promise.all([withTestOrg(), withTestOrg()]);
  });
  afterEach(async () => {
    await Promise.all([org.cleanup(), org2.cleanup()]);
  });

  async function confirmedAppt() {
    return createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'confirmed',
    });
  }

  it('401 with no Authorization header', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      body: { content: 'hi' },
    });
    expect(status).toBe(401);
  });

  it('404 for an unknown appointment', async () => {
    const { status } = await callRoute(handlerFor('00000000-0000-0000-0000-000000000000'), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'hi' },
    });
    expect(status).toBe(404);
  });

  it('403 for a non-participant caller', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org2.homeowner.accessToken),
      body: { content: 'let me in' },
    });
    expect(status).toBe(403);
  });

  it('201 homeowner -> cleaner: creates the appointment-scoped conversation, inserts the message, notifies the cleaner', async () => {
    const appt = await confirmedAppt();
    const { status, body } = await callRoute<{ message: { conversation_id: string } }>(
      handlerFor(appt.id),
      {
        method: 'POST',
        headers: bearerHeader(org.homeowner.accessToken),
        body: { content: 'Gate code is 1234' },
      },
    );
    expect(status).toBe(201);

    const { data: convs } = await admin
      .from('conversations')
      .select('id, appointment_id')
      .eq('appointment_id', appt.id);
    expect(convs).toHaveLength(1);
    expect(body.message.conversation_id).toBe(convs![0].id);

    const { data: msgs } = await admin
      .from('messages')
      .select('sender_id, recipient_id, appointment_id, content')
      .eq('appointment_id', appt.id);
    expect(msgs).toHaveLength(1);
    expect(msgs![0].recipient_id).toBe(org.cleaner.userId);
    expect(msgs![0].sender_id).toBe(org.homeowner.userId);

    const recipients = (await jobMessageNotifs(appt.id)).map((n) => n.recipient_user_id);
    expect(recipients).toEqual([org.cleaner.userId]);
  });

  it('201 cleaner -> homeowner: notifies the homeowner', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'in_progress',
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { content: 'Running 10 min late' },
    });
    expect(status).toBe(201);
    const recipients = (await jobMessageNotifs(appt.id)).map((n) => n.recipient_user_id);
    expect(recipients).toEqual([org.homeowner.userId]);
  });

  it('reuses one conversation across multiple sends on the same appointment', async () => {
    const appt = await confirmedAppt();
    for (const content of ['one', 'two']) {
      await callRoute(handlerFor(appt.id), {
        method: 'POST',
        headers: bearerHeader(org.homeowner.accessToken),
        body: { content },
      });
    }
    const { data: convs } = await admin.from('conversations').select('id').eq('appointment_id', appt.id);
    expect(convs).toHaveLength(1);
    const { data: msgs } = await admin.from('messages').select('id').eq('appointment_id', appt.id);
    expect(msgs).toHaveLength(2);
  });

  it('recurring: two appointments for the same homeowner+cleaner get DISTINCT threads', async () => {
    const a1 = await confirmedAppt();
    const a2 = await confirmedAppt();
    await callRoute(handlerFor(a1.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'thread 1' },
    });
    await callRoute(handlerFor(a2.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'thread 2' },
    });
    const { data: c1 } = await admin.from('conversations').select('id').eq('appointment_id', a1.id).single();
    const { data: c2 } = await admin.from('conversations').select('id').eq('appointment_id', a2.id).single();
    expect(c1!.id).not.toBe(c2!.id);
  });

  it('409 when no cleaner is assigned yet', async () => {
    const appt = await confirmedAppt();
    await admin.from('appointments').update({ cleaner_id: null }).eq('id', appt.id);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'anyone there?' },
    });
    expect(status).toBe(409);
  });

  it('403 when the org kill-switch is off', async () => {
    const appt = await confirmedAppt();
    await admin
      .from('organizations')
      .update({ homeowner_cleaner_messaging_enabled: false })
      .eq('id', org.organizationId);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'blocked?' },
    });
    expect(status).toBe(403);
  });

  it('403 when the window is closed (pending)', async () => {
    const appt = await createTestAppointment({
      organizationId: org.organizationId,
      cleanerId: org.cleaner.userId,
      homeownerId: org.homeowner.userId,
      status: 'pending',
    });
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'too early' },
    });
    expect(status).toBe(403);
  });

  it('403 when cancelled', async () => {
    const appt = await confirmedAppt();
    await admin.from('appointments').update({ status: 'cancelled' }).eq('id', appt.id);
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'too late' },
    });
    expect(status).toBe(403);
  });

  it('201 within the 24h grace, 403 after it', async () => {
    const within = await confirmedAppt();
    await admin
      .from('appointments')
      .update({ status: 'completed', completed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
      .eq('id', within.id);
    const okRes = await callRoute(handlerFor(within.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'thanks!' },
    });
    expect(okRes.status).toBe(201);

    const after = await confirmedAppt();
    await admin
      .from('appointments')
      .update({ status: 'completed', completed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })
      .eq('id', after.id);
    const lateRes = await callRoute(handlerFor(after.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'too late now' },
    });
    expect(lateRes.status).toBe(403);
  });

  it('400 for empty content', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: '   ' },
    });
    expect(status).toBe(400);
  });

  it('400 for content over the max length', async () => {
    const appt = await confirmedAppt();
    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'x'.repeat(4001) },
    });
    expect(status).toBe(400);
  });

  it('reassignment: the old cleaner can no longer send (403)', async () => {
    const appt = await confirmedAppt();
    // True reassignment to a different cleaner. org2.cleaner has a cleaner_profiles
    // row, so the FK (appointments.cleaner_id -> cleaner_profiles(id)) is satisfied
    // (the FK is org-agnostic). Assert the update applied so a future FK regression
    // surfaces here rather than as a silent no-op.
    const { error: reassignError } = await admin
      .from('appointments')
      .update({ cleaner_id: org2.cleaner.userId })
      .eq('id', appt.id);
    expect(reassignError).toBeNull();

    const { status } = await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { content: 'still me?' },
    });
    expect(status).toBe(403);
  });

  it('RLS: participants + org staff can read the job messages; outsiders cannot', async () => {
    const appt = await confirmedAppt();
    await callRoute(handlerFor(appt.id), {
      method: 'POST',
      headers: bearerHeader(org.homeowner.accessToken),
      body: { content: 'visible?' },
    });

    const cleanerClient = createUserClient(org.cleaner.accessToken);
    const { data: cleanerView } = await cleanerClient.from('messages').select('id').eq('appointment_id', appt.id);
    expect((cleanerView ?? []).length).toBeGreaterThan(0);

    const staffClient = createUserClient(org.admin.accessToken); // org admin -> org-staff messages read
    const { data: staffView } = await staffClient.from('messages').select('id').eq('appointment_id', appt.id);
    expect((staffView ?? []).length).toBeGreaterThan(0);

    const outsiderClient = createUserClient(org2.homeowner.accessToken);
    const { data: outsiderView } = await outsiderClient.from('messages').select('id').eq('appointment_id', appt.id);
    expect(outsiderView ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- messages/route.integration`
Expected: FAIL (cannot import `./route` — module does not exist yet).

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/appointments/[appointmentId]/messages/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { isJobMessagingWindowOpen } from '@/lib/messaging/jobMessagingWindow';
import { uuidv4 } from '@/lib/uuid';

const MAX_CONTENT = 4000;

/**
 * POST /api/appointments/:appointmentId/messages
 *
 * Guarded homeowner<->cleaner job-thread send. `can_message_role` forbids the
 * homeowner<->cleaner pair, so this message cannot be inserted by the client
 * under RLS; the route authenticates the caller, enforces the gate, and writes
 * with the service-role admin client. RLS remains the backstop (the channel is
 * closed except through this route).
 *
 * Body: { content: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    const { appointmentId } = await params;

    // 1. Authenticate the caller (identity-gated, not org-role-gated).
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }
    const verified = await verifyAccessToken(supabaseAdmin, token);
    if (!verified) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { content?: unknown };

    // 2. Load the appointment.
    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id, homeowner_id, cleaner_id, status, started_at, completed_at, cancelled_at')
      .eq('id', appointmentId)
      .maybeSingle();
    const appt = apptRow as {
      id: string;
      organization_id: string;
      homeowner_id: string | null;
      cleaner_id: string | null;
      status: string;
      started_at: string | null;
      completed_at: string | null;
      cancelled_at: string | null;
    } | null;
    if (!appt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // 3. The caller must be the current homeowner or the current assigned cleaner.
    let recipientId: string | null;
    if (verified.userId === appt.homeowner_id) {
      recipientId = appt.cleaner_id;
    } else if (verified.userId === appt.cleaner_id) {
      recipientId = appt.homeowner_id;
    } else {
      return NextResponse.json({ error: 'You are not a participant on this cleaning' }, { status: 403 });
    }

    // 4. The counterparty must exist (no cleaner assigned yet, or a self-pay job with no homeowner).
    if (!recipientId) {
      return NextResponse.json({ error: 'There is no one to message on this cleaning yet' }, { status: 409 });
    }
    // 4b. Defense-in-depth: a degenerate appointment where the same user is both
    //     parties would make p1 === p2 and violate the conversations
    //     different_participants CHECK (an opaque 500). Fail cleanly instead.
    if (recipientId === verified.userId) {
      return NextResponse.json({ error: 'There is no one to message on this cleaning yet' }, { status: 409 });
    }

    // 5. Org kill-switch.
    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('homeowner_cleaner_messaging_enabled')
      .eq('id', appt.organization_id)
      .maybeSingle();
    const messagingEnabled =
      (orgRow as { homeowner_cleaner_messaging_enabled: boolean } | null)?.homeowner_cleaner_messaging_enabled ?? true;
    if (!messagingEnabled) {
      return NextResponse.json({ error: 'Messaging is turned off for this company' }, { status: 403 });
    }

    // 6. Send window.
    if (!isJobMessagingWindowOpen(appt, new Date())) {
      return NextResponse.json({ error: 'Messaging is closed for this cleaning' }, { status: 403 });
    }

    // 7. Validate content last, so non-participants never reach it.
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }
    if (content.length > MAX_CONTENT) {
      return NextResponse.json(
        { error: `Message is too long (max ${MAX_CONTENT} characters)` },
        { status: 400 },
      );
    }

    // 8. Resolve (or create) the per-appointment conversation (service role only).
    const { data: convId, error: convError } = await supabaseAdmin.rpc('get_or_create_job_conversation', {
      p_user_a: verified.userId,
      p_user_b: recipientId,
      p_appointment_id: appointmentId,
    });
    if (convError || !convId) {
      return NextResponse.json(
        { error: 'Could not open the conversation', details: convError?.message },
        { status: 500 },
      );
    }

    // 9. Insert the message (bypasses RLS; the gate above is the authority). The
    //    update_conversation_last_message trigger maintains conversations.last_message_at.
    const messageId = uuidv4();
    const { error: insertError } = await supabaseAdmin.from('messages').insert({
      id: messageId,
      organization_id: appt.organization_id,
      conversation_id: convId as string,
      sender_id: verified.userId,
      recipient_id: recipientId,
      content,
      is_read: false,
      appointment_id: appointmentId,
    });
    if (insertError) {
      return NextResponse.json(
        { error: 'Could not send the message', details: insertError.message },
        { status: 500 },
      );
    }

    // 10. Notify the counterparty (best-effort). Sender display name comes from context.
    const ctx = await loadNotificationContext(supabaseAdmin, {
      appointmentId,
      cleanerId: appt.cleaner_id,
    });
    const senderIsCleaner = verified.userId === appt.cleaner_id;
    const senderName = senderIsCleaner ? ctx.cleaner_name : ctx.customer_name;
    const snippet = content.length > 140 ? `${content.slice(0, 140)}...` : content;
    await recordNotificationEvent(supabaseAdmin, {
      event_type: 'job_message',
      appointment_id: appointmentId,
      organization_id: appt.organization_id,
      recipient_user_id: recipientId,
      payload: {
        ...ctx,
        audience: senderIsCleaner ? 'homeowner' : 'cleaner',
        sender_name: senderName ?? null,
        snippet,
        message_id: messageId,
      },
      dedupe_key: `job_message:${messageId}`,
    });

    return NextResponse.json(
      {
        message: {
          id: messageId,
          conversation_id: convId,
          sender_id: verified.userId,
          recipient_id: recipientId,
          appointment_id: appointmentId,
          organization_id: appt.organization_id,
          content,
          is_read: false,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error sending job message:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- messages/route.integration`
Expected: PASS (all cases). If a single case flakes on auth, re-run the file alone (parallel-GoTrue flake, not a code bug).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/appointments/[appointmentId]/messages/route.ts" "src/app/api/appointments/[appointmentId]/messages/route.integration.test.ts"
git commit -m "feat(messaging): guarded job-message send route + gating/RLS tests"
```

---

## Task 5: Per-org kill-switch settings row

**Files:**
- Modify: `src/app/api/organizations/[orgId]/cleaner-experience/route.ts`
- Modify: `src/components/redesign/settings/sections/CleanerExperienceSection.tsx`
- Extend (already exists): `src/app/api/organizations/[orgId]/cleaner-experience/route.integration.test.ts`

**Interfaces:**
- Consumes: migration 098's `organizations.homeowner_cleaner_messaging_enabled` (Task 1).
- Produces: `PATCH /api/organizations/:orgId/cleaner-experience` now accepts `homeowner_cleaner_messaging_enabled: boolean` (owner/admin only); the "Cleaner experience" settings section renders a toggle for it.

- [ ] **Step 1: Add two failing cases to the EXISTING integration test file**

`src/app/api/organizations/[orgId]/cleaner-experience/route.integration.test.ts` **already exists** (it imports vitest + `callRoute`/`bearerHeader` + `withTestOrg`, defines a top-level `handlerFor`, instantiates a service-role client via `createTestSupabaseClient()`, and has a `describe('PATCH /api/organizations/:orgId/cleaner-experience')` block with ~5 cases). **Do NOT recreate it** (that would duplicate imports + redeclare `handlerFor`). Open it and add ONLY these two `it(...)` blocks inside the existing `describe`. Reuse the file's existing service-client variable (it is named `db` in the file; adapt the name below if different):

```ts
  it('an admin can turn homeowner_cleaner_messaging_enabled off, and it persists', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.admin.accessToken),
      body: { homeowner_cleaner_messaging_enabled: false },
    });
    expect(status).toBe(200);
    const { data } = await db
      .from('organizations')
      .select('homeowner_cleaner_messaging_enabled')
      .eq('id', org.organizationId)
      .single();
    expect(data?.homeowner_cleaner_messaging_enabled).toBe(false);
  });

  it('a cleaner cannot change the messaging flag (403)', async () => {
    const { status } = await callRoute(handlerFor(org.organizationId), {
      method: 'PATCH',
      headers: bearerHeader(org.cleaner.accessToken),
      body: { homeowner_cleaner_messaging_enabled: false },
    });
    expect(status).toBe(403);
  });
```

(The `org` fixture variable + its `beforeEach`/`afterEach` lifecycle already exist in the file; these two cases reuse them. If the file's service client is not named `db`, use whatever name it already declares.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- cleaner-experience/route.integration`
Expected: FAIL (the route ignores the new field, so the persisted value stays `true` / the assertion fails). The 403 case may already pass (gating is unchanged) - the persistence case is the red one.

- [ ] **Step 3: Accept + validate the new field in the route**

In `src/app/api/organizations/[orgId]/cleaner-experience/route.ts`:

(a) Extend the body type:

```ts
    const body = (await request.json().catch(() => ({}))) as {
      cleaner_pay_display?: string;
      require_job_photos?: unknown;
      homeowner_cleaner_messaging_enabled?: unknown;
    };
```

(b) Add a third update block (after the `require_job_photos` block, before the empty-update check):

```ts
    if (body.homeowner_cleaner_messaging_enabled !== undefined) {
      update.homeowner_cleaner_messaging_enabled = Boolean(body.homeowner_cleaner_messaging_enabled);
    }
```

- [ ] **Step 4: Run the route test to verify it passes**

Run: `npm run test:integration -- cleaner-experience/route.integration`
Expected: PASS (both cases).

- [ ] **Step 5: Add the toggle to `CleanerExperienceSection.tsx`**

In `src/components/redesign/settings/sections/CleanerExperienceSection.tsx`:

(a) Extend the form interface:

```tsx
interface CleanerExperienceForm {
  cleaner_pay_display: CleanerPayDisplay;
  require_job_photos: boolean;
  homeowner_cleaner_messaging_enabled: boolean;
}
```

(b) Extend `load()`'s select + return:

```tsx
    const { data, error } = await supabase
      .from("organizations")
      .select("cleaner_pay_display, require_job_photos, homeowner_cleaner_messaging_enabled")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      cleaner_pay_display: (data?.cleaner_pay_display as CleanerPayDisplay) ?? "full",
      require_job_photos: data?.require_job_photos ?? true,
      homeowner_cleaner_messaging_enabled: data?.homeowner_cleaner_messaging_enabled ?? true,
    };
```

(c) Extend `save()`'s payload:

```tsx
    await updateOrgCleanerExperience(currentOrganizationId, {
      cleaner_pay_display: v.cleaner_pay_display,
      require_job_photos: v.require_job_photos,
      homeowner_cleaner_messaging_enabled: v.homeowner_cleaner_messaging_enabled,
    });
```

(d) Add a `SettingRow` + `Switch` (place it after the "Require job photos" row, before `SettingsSaveBar`):

```tsx
      <SettingRow
        label="Homeowner and cleaner messaging"
        htmlFor="homeowner-cleaner-messaging"
        helper="Let homeowners and the assigned cleaner message each other about an active cleaning. Office threads are unaffected."
      >
        <Switch
          id="homeowner-cleaner-messaging"
          checked={value.homeowner_cleaner_messaging_enabled}
          onCheckedChange={(checked) =>
            setValue({ ...value, homeowner_cleaner_messaging_enabled: checked })
          }
        />
      </SettingRow>
```

- [ ] **Step 6: Type-check + lint the touched files**

Run: `npx tsc --noEmit`
Expected: no NEW errors in `CleanerExperienceSection.tsx` or the route (pre-existing repo errors may still print).
Run: `npm run lint`
Expected: clean for the touched files.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/organizations/[orgId]/cleaner-experience/route.ts" "src/app/api/organizations/[orgId]/cleaner-experience/route.integration.test.ts" src/components/redesign/settings/sections/CleanerExperienceSection.tsx
git commit -m "feat(messaging): per-org homeowner-cleaner messaging kill-switch (settings + route)"
```

---

## Final verification (before PR)

- [ ] **Unit + integration suite:** `npm run test` green (or the touched files green in isolation if the full run hits the known parallel-GoTrue flake; CI runs the full suite).
- [ ] **Schema rebuild:** `npx supabase db reset` rebuilds cleanly with 098 applied.
- [ ] **Types/lint:** `npx tsc --noEmit` shows no errors you introduced; `npm run lint` clean for touched files.
- [ ] **No em dashes** in any added user-facing string (errors, notification title/snippet, settings labels).
- [ ] **Codex review:** `/codex:review --scope branch --base master --wait`; apply valid fixes in a follow-up commit.
- [ ] **PR to master**, four checks green, merge (user-gated). Migration applies to dev on push, to prod on merge.

---

## Roadmap: the consumers (separate plans, after PR1 merges)

These are outlined here for continuity; each gets its own plan + PR (one per slice, like the cleaner app). PR1 ships nothing that emits a `job_message` in production until a consumer wires sending.

- **PR2 - Homeowner Slice 3 (Messages tab).** Replace the stub `src/app/(redesign)/app/homeowner-dashboard/messages/page.tsx` with a sectioned inbox (Office pinned + active "Your cleanings" job threads + Past), built on a shared sectioned-inbox derive that replaces `deriveOfficeInbox`'s 1-vs-many heuristic. Reuse `MessageThreadPanel`/`MessageComposer`/`MobileTakeover`; read-only composer when the window is closed (reuse `isJobMessagingWindowOpen`). Wire "Message about this cleaning" (job send via the PR1 route) + "Message office" (existing client path) into `HomeownerCleaningDetail.tsx` (the seam after the fields card) + optionally the Home hero. Extend `useConversations` to surface `appointment_id` (additive). Add a `useSendJobMessage` client wrapper that POSTs to the route + optimistic append (mirror `useSendMessage`'s temp-id reconcile). Refine the homeowner `job_message` deep-link to open the thread. Tests: inbox derivation (Office + N job threads, active/archived), read-only archived rendering. Playwright on the Vercel preview (homeowner role + redesign flag); user is on mobile, so drive the preview and send screenshots.
- **PR3 - Cleaner companion.** Add an "active job thread (to homeowner)" entry point from `CleanerActiveJob` (reuse the `useOpenOfficeThread` `?to=&appointment=&from=` plumbing, but send via the PR1 route) + a job-threads section in the cleaner inbox (adopt the shared sectioned derive). Refine the cleaner `job_message` deep-link.
- **PR4 - Operator read-only job-thread panel.** A read-only "messages on this job" panel in `src/components/redesign/bookings/BookingDetailSheet.tsx` (the seam between the message buttons and the special-requests field), reusing `MessageThreadPanel` filtered by `messages.appointment_id` (the existing org-staff `messages_select` policy already permits the read; no new conversations policy).

---

## Self-Review

- **Spec coverage (job-messaging brief sections 4-6):** decision #1 per-(appointment, cleaner) stint -> `unique_job_conversation` + the route's current-`cleaner_id` participant check + the reassignment test (Task 1/4). #2 office reads via `messages.appointment_id` -> no new conversations policy; covered by the RLS read test + deferred panel in PR4. #3 grace via real timestamps -> `isJobMessagingWindowOpen` uses `completed_at + 24h` (Task 2, used in Task 4). #4 job-thread-only notification -> `job_message` emit (Tasks 3-4). #5 sectioned inbox -> PR2/PR3 (roadmap). #6 kill-switch in Cleaner experience -> Task 5. Migration shape (section 5) -> Task 1. Send-gating (section 5) -> Task 4. Tests (section 6: blocked after complete+grace / on cancel / flag off / non-current-participant; RLS negatives; reassignment; recurring distinct threads; org-staff scoped read) -> all present in Task 4's integration matrix.
- **Placeholder scan:** none; every code step shows complete code.
- **Type consistency:** `isJobMessagingWindowOpen(appt, now)` signature identical in Task 2 + Task 4; route emits `event_type: 'job_message'` which Task 3 adds to the union + `KNOWN_TYPES`; `get_or_create_job_conversation(p_user_a, p_user_b, p_appointment_id)` parameter names match between the migration (Task 1) and the route's `.rpc(...)` call (Task 4); `homeowner_cleaner_messaging_enabled` column name identical across migration, route, and section (Tasks 1/5).
