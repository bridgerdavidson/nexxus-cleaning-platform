# Sub-project 1a: Shared office inbox — backend foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Give `conversations` an `organization_id` (backfilled + auto-set on new threads) and an org-staff RLS read policy for **office threads only**, so any admin/manager can later read/answer the org's office threads. Pure backend foundation: no UI, no data-mutating consolidation.

**Architecture:** One migration (099). Adds `conversations.organization_id` (nullable FK + index), backfills it from each conversation's existing messages (messages already carry `organization_id`), adds a trigger that sets it from the first message of any still-null conversation (covers threads created post-migration without changing the `get_or_create_conversation` RPC or any client path), and adds a **new permissive** SELECT policy on `conversations` scoped to office threads (`appointment_id IS NULL`) for org admins/managers via `is_admin_or_manager_in_org(organization_id)`. Job threads are deliberately NOT exposed via `conversations` (operators read job *messages* via the existing `messages` org-staff policy).

**Tech Stack:** Supabase Postgres + RLS; Vitest integration tests against local Supabase (`tests/helpers/{supabase,auth,db,fixtures}.ts`).

## Global Constraints
- Migrations are immutable once shipped; this is a NEW migration (099). Never push migrations directly to prod (the pipeline applies on merge).
- Additive + non-destructive only: a new nullable column, a backfill UPDATE (fills nulls), a trigger, and a NEW permissive policy. Do NOT alter or drop the existing `conversations_select`/insert/update/delete policies. No `DELETE`/re-point of any existing rows (consolidation is a separate later migration).
- The office-read policy MUST be scoped to `appointment_id IS NULL` (office threads only) so job threads are never exposed through `conversations`.
- Integration tests use the existing helpers (`createTestSupabaseClient`, `withTestOrg`, `createUserClient`/the RLS-client helper, `createTestAppointment`); do not roll your own org/user setup.

---

## Task 1: Migration 099 — conversations.organization_id + backfill + trigger + office-read RLS

**Files:**
- Create: `supabase/migrations/099_conversations_org_id.sql`

**Interfaces:**
- Produces: `conversations.organization_id uuid` (nullable, FK -> organizations, indexed); a trigger that sets it from the first message; a new SELECT policy `conversations_select_org_office`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/099_conversations_org_id.sql`:
```sql
-- 099_conversations_org_id.sql
-- Give conversations an organization_id so the shared OFFICE inbox can be
-- org-scoped (operator console query) and protected by an org-staff RLS read
-- policy. Office threads (appointment_id IS NULL) only; job threads stay
-- readable to staff via the existing messages org-staff policy, not here.

-- 1. Column + index. Nullable: a conversation with no messages yet has no org.
alter table public.conversations
  add column if not exists organization_id uuid
  references public.organizations(id) on delete set null;

create index if not exists idx_conversations_organization
  on public.conversations (organization_id)
  where organization_id is not null;

-- 2. Backfill from existing messages (messages carry organization_id NOT NULL).
--    A conversation's messages all share one org, so any message works.
update public.conversations c
set organization_id = m.organization_id
from (
  select distinct on (conversation_id) conversation_id, organization_id
  from public.messages
  where organization_id is not null
  order by conversation_id, created_at asc
) m
where m.conversation_id = c.id
  and c.organization_id is null;

-- 3. Trigger: set a conversation's organization_id from the first message that
--    carries one, for conversations created without it (the get_or_create RPC
--    does not set org). Fires only while still null, so it is a one-time set.
create or replace function public.set_conversation_org_from_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.organization_id is not null then
    update public.conversations
      set organization_id = new.organization_id
      where id = new.conversation_id
        and organization_id is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_conversation_org on public.messages;
create trigger trg_set_conversation_org
  after insert on public.messages
  for each row
  execute function public.set_conversation_org_from_message();

-- 4. New PERMISSIVE select policy: org admins/managers can read their org's
--    OFFICE threads (appointment_id IS NULL) even when not a participant.
--    OR'd with the existing participant-scoped conversations_select; the
--    existing policies are untouched. Job threads are excluded by design.
drop policy if exists conversations_select_org_office on public.conversations;
create policy conversations_select_org_office on public.conversations
  for select to authenticated
  using (
    appointment_id is null
    and organization_id is not null
    and public.is_admin_or_manager_in_org(organization_id)
  );
```

- [ ] **Step 2: Verify the schema rebuilds cleanly**

Run: `npx supabase db reset`
Expected: completes with no error; migration 099 applies after 098.
Run a quick check that the column + policy exist:
`npx supabase db reset` then via `psql`/Studio (or the integration test in Task 2) confirm `conversations.organization_id` exists and `conversations_select_org_office` is listed.

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/099_conversations_org_id.sql
git commit -m "feat(messaging): conversations.organization_id + org-staff office-read RLS (migration 099)"
```

---

## Task 2: Integration test — office-read RLS + trigger backfill

**Files:**
- Create: `src/app/api/_messaging/conversations-org-office-rls.integration.test.ts` (or co-locate near an existing messaging integration test; pick a path consistent with the repo's integration-test convention and the helpers' import depth)

**Interfaces:**
- Consumes: `createTestSupabaseClient` (service role), `withTestOrg`, the RLS-client helper (`createUserClient`/`createUserSupabaseClient` — match the existing helper name), `createTestAppointment`.

- [ ] **Step 1: Write the failing test**

The test seeds, via the service-role client, two orgs each with: an admin, a manager, a homeowner; an OFFICE conversation (homeowner <-> admin, `appointment_id NULL`) with a message (so `organization_id` is set by the trigger / backfill path); and a JOB conversation (`appointment_id` set). It then asserts, using RLS clients:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSupabaseClient } from '../../../../tests/helpers/supabase'; // adjust depth
import { withTestOrg } from '../../../../tests/helpers/db';
import { createUserClient } from '../../../../tests/helpers/auth'; // match real helper name

// Pseudocode-precise: use the real helpers' signatures. Build orgA + orgB each
// with admin/manager/homeowner; insert an office conversation (homeowner+admin,
// appointment_id null) + one message in it (org set via trigger); and a job
// conversation (appointment_id set).

describe('conversations org-staff office-read RLS (099)', () => {
  it('org admin who is NOT a participant can read their org office thread', async () => {
    // orgA.manager (not a participant of the homeowner<->admin office thread)
    // selects the office conversation row by id -> data is non-null.
  });
  it('org staff CANNOT read another org office thread', async () => {
    // orgB.manager selects orgA's office conversation id -> null/empty.
  });
  it('org staff CANNOT read a job thread via conversations (appointment_id set)', async () => {
    // orgA.manager selects a job conversation (appointment_id not null) -> null/empty
    // (job office-read is via messages, not conversations).
  });
  it('a non-staff user who is not a participant CANNOT read the office thread', async () => {
    // an unrelated homeowner selects orgA's office conversation id -> null/empty.
  });
  it('trigger sets organization_id when the first message is inserted', async () => {
    // service-role: create an office conversation with organization_id NULL,
    // insert a message with organization_id = orgA.id, then re-select the
    // conversation -> organization_id === orgA.id.
  });
});
```

Write these with the REAL helper signatures (read an existing `*.integration.test.ts` first to copy the exact `createTestSupabaseClient`/`withTestOrg`/RLS-client usage, the org fixture shape, and how a homeowner/admin/manager + conversation + message are seeded). Each assertion must check real RLS behavior (a non-participant staff read returns the row; a cross-org or job or non-staff read returns nothing), not mocks.

- [ ] **Step 2: Run it to confirm RED, then GREEN**

Requires local Supabase up (`npx supabase start`) + `.env.test.local`.
Run: `npm run test:integration -- <this test file>`
Expected (pre-migration baseline if run on an older DB): the office-read assertions FAIL.
After `npx supabase db reset` (applies 099): Expected PASS (5 assertions). Note: the integration suite flakes on parallel GoTrue auth; run this file in isolation.

- [ ] **Step 3: Commit**
```bash
git add <the test file>
git commit -m "test(messaging): office-read RLS + org_id trigger integration tests (099)"
```

---

## Self-Review
- **Spec coverage:** §4 (conversations.organization_id + org-staff office RLS) and §6 (migration) are implemented; consolidation, the homeowner single-office-row, the operator console, and the office_message notification are explicitly OUT of this sub-project (later 1b/1c/follow-ups), per the de-risking decision.
- **Type/SQL consistency:** the policy uses `is_admin_or_manager_in_org(organization_id)` (signature `(check_org_id uuid)`, verified in 000_baseline.sql:559); the office scope is `appointment_id IS NULL`; the new policy is additive/permissive and leaves `conversations_select` intact.
- **Placeholder scan:** Task 2's test bodies are described precisely but must be filled with the real helper signatures by reading an existing integration test first — that is an instruction, not a shipped placeholder; the assertions + seeding are fully specified.
