# Sub-project 1b: Org-scoped operator office inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make the operator (admin/manager) Messages console an **org-scoped shared office inbox**: instead of showing only the logged-in staff member's own conversations, show **all of the org's office threads** (customer<->office, `appointment_id IS NULL`) so any admin/manager can read and reply to any of them. Replies are attributed to whoever answered; the customer keeps seeing "Cleaning office".

**Architecture:** Add an `org-office` mode to `useConversations` that queries by `conversations.organization_id` (added in 1a/099) instead of by participant, relying on the 099 org-staff office-read RLS. Because the operator is usually NOT a participant of a customer's office thread, the "other participant" for display can't be "the one that isn't me" — it must be the **customer** participant (role homeowner/cleaner). `OperatorMessages` switches to this mode and routes replies to that customer participant via the existing `useSendMessage` (RLS `messages_insert` branch 2 already lets any org admin/manager insert). No new migration; relies on 099 (+ the 100 hardening already landing separately). Read-only JOB threads + the booking panel are sub-project 2, NOT here; 1b is office threads only (all replyable).

**Tech Stack:** Next.js `(redesign)`, React 19, TanStack Query, Tailwind design system; Vitest.

## Global Constraints
- Design system only; no raw hex; no `primary-<number>` (legacy yellow); semantic tokens.
- No em dashes in user-facing copy; "office" not "operator" in any CUSTOMER-facing string (operator-facing UI may say operator/admin/manager as today).
- Never import `lib/supabase-admin` from client code.
- **Do not change** the participant-scoped behavior of `useConversations` for its existing callers (cleaner `CleanerMessages`, homeowner `HomeownerMessages` office/job scopes). The new mode is additive (opt-in via a new scope value), default unchanged.
- Enforce `can_view_messages` at the app layer (the 099 DB read is role-based; `OperatorMessages` already gates on owner/admin OR `can_view_messages` — keep that gate).

## Background (verified)
- `useConversations({ userId, scope = 'office' | 'job', searchQuery, roleFilter })` (`src/hooks/useConversations.ts`): query `.or(participant_1.eq.userId, participant_2.eq.userId)` + `appointment_id` scope filter; builds `ConversationWithDetails` with `other_participant = the non-userId participant`; realtime channels keyed `...:${userId}:${scope}`.
- `OperatorMessages.tsx`: gates on `currentOrgRole` owner/admin OR `permissions.can_view_messages`; calls `useConversations({ userId })` (line ~66); applies `deriveMessages(rows, {search, unreadOnly, roleFilter})`; selection via `?c=`; replies via `useSendMessage`.
- 099: `conversations.organization_id` + RLS `conversations_select_org_office` (admin/manager can read org office threads, `appointment_id IS NULL`). `messages_insert` (089) branch 2 lets any org admin/manager insert (`sender_id = self`, `is_admin_or_manager_in_org(org)`), so a non-participant operator CAN reply.

---

## Task 1: `useConversations` org-office mode (customer-participant derivation)

**Files:**
- Modify: `src/hooks/useConversations.ts`
- Modify: `src/lib/queryKeys.ts` (the conversations key already takes a scope; ensure `'org-office'` is a valid scope value in the union)

**Interfaces:**
- Produces: `useConversations({ userId, scope: 'org-office', orgId })` returning the org's office `ConversationWithDetails[]`, each `other_participant` = the **customer** (homeowner/cleaner) participant.

- [ ] **Step 1: Extend options + scope union**

```typescript
interface UseConversationsOptions {
  userId: string;
  scope?: 'office' | 'job' | 'org-office';
  orgId?: string;            // required when scope === 'org-office'
  searchQuery?: string;
  roleFilter?: UserRole | 'all';
}
```
Update `keys.conversations.byUser(userId, scope)` callers/type so `'org-office'` is accepted (it already takes a `scope` string param — widen the literal union there too if it is typed).

- [ ] **Step 2: Branch the query for org-office**

In the `queryFn`, when `scope === 'org-office'`, query by org instead of participant (the 099 RLS authorizes it):
```typescript
if (scope === 'org-office') {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('organization_id', orgId as string)
    .is('appointment_id', null)
    .order('last_message_at', { ascending: false });
  // ...use `data` as conversationsData below
}
```
Gate the query `enabled` on `!!orgId` when in this mode (in addition to `!!userId`).

- [ ] **Step 3: Customer-participant derivation for org-office**

The operator is usually NOT a participant, so `other_participant` cannot be "the non-userId participant". For `org-office`, fetch BOTH participants' profiles (the existing code already fetches participant profiles; in org mode collect both ids per conversation) and pick the **customer** = the participant whose `role` is `homeowner` or `cleaner`; if both are staff (staff<->staff thread) fall back to the participant that is not `userId`, else `participant_1`. Implement a small helper:
```typescript
function pickDisplayParticipant(
  conv: { participant_1_id: string; participant_2_id: string },
  profiles: Map<string, UserProfile>,
  selfId: string,
): UserProfile | undefined {
  const p1 = profiles.get(conv.participant_1_id);
  const p2 = profiles.get(conv.participant_2_id);
  const isCustomer = (p?: UserProfile) => p?.role === 'homeowner' || p?.role === 'cleaner';
  if (isCustomer(p1)) return p1;
  if (isCustomer(p2)) return p2;
  // staff<->staff: show the other party
  return conv.participant_1_id === selfId ? p2 : p1;
}
```
In `org-office` mode, build `participantIds` from BOTH participants of every conversation (not just the non-self one), fetch their profiles, and set `other_participant = pickDisplayParticipant(conv, profilesMap, userId)`. Keep the existing participant-scoped path EXACTLY as-is for `'office'`/`'job'` (use the non-userId participant). Unread count for org-office: keep counting `messages` where `recipient_id = userId AND is_read = false` (only the operator's own unread) OR 0 for threads they don't participate in — pick the simpler correct option: in org mode, per-conversation unread is "messages addressed to me" which is fine (a shared inbox unread model is out of scope; the existing per-recipient unread is acceptable). Document the choice in a comment.

- [ ] **Step 4: Realtime keyed by org (avoid channel-dedup collision)**

When `scope === 'org-office'`, suffix the realtime `channelName`s with the org + scope (e.g. `conversations:org:${orgId}:org-office`) and filter on `organization_id=eq.${orgId}` where a DB-level filter is possible, so the operator's org-office cache invalidates on any org conversation/message change. Do not reuse the participant-keyed channel names.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` (no new errors; existing callers unchanged — they pass no `orgId` and keep `'office'`/`'job'`). Add/adjust a focused unit test only if a pure helper (`pickDisplayParticipant`) is extracted to its own file; otherwise rely on the integration check in Task 2 + the existing suite.

- [ ] **Step 6: Commit**
```bash
git add src/hooks/useConversations.ts src/lib/queryKeys.ts
git commit -m "feat(messaging): useConversations org-office mode (org-scoped, customer-participant)"
```

---

## Task 2: Operator console uses the org-office inbox + replies to non-participant threads

**Files:**
- Modify: `src/components/redesign/messages/OperatorMessages.tsx`
- Possibly Modify: `src/components/redesign/messages/messages-presenters.tsx` (only if the reply recipient needs the customer id surfaced)

**Interfaces:**
- Consumes: `useConversations({ userId, scope: 'org-office', orgId: currentOrganizationId })`, `useSendMessage`.

- [ ] **Step 1: Switch the inbox to org-office**

In `OperatorMessages` (the data container), change the conversations hook call:
```typescript
const { conversations, loading: inboxLoading, updateUnreadCount } = useConversations({
  userId,
  scope: 'org-office',
  orgId: currentOrganizationId ?? '',
});
```
Keep the existing `can_view_messages` gate (do not loosen it). The inbox now lists the org's office threads (each labeled by its customer via the Task 1 derivation). The existing `deriveMessages` search/role-filter still applies (role filter now filters by the customer's role).

- [ ] **Step 2: Route replies to the customer participant**

When the operator sends in a selected thread, the recipient must be the **customer** participant of that conversation (the `other_participant` from Task 1), NOT "the other participant relative to the operator" (the operator may not be a participant). Ensure the send uses the selected conversation's `other_participant.id` as `recipientId`:
```typescript
const res = await sendMessage({
  conversationId: selectedConversation.id,
  senderId: userId,
  recipientId: selectedConversation.other_participant.id, // the customer (Task 1 derivation)
  content,
  // org defaults handled by useSendMessage (currentOrganizationId) -> RLS branch 2 allows
});
```
Verify `useSendMessage` sets `organization_id = currentOrganizationId` (the operator's org) so `messages_insert` branch 2 (`is_admin_or_manager_in_org`) authorizes the insert into a thread the operator doesn't participate in. (It does today.)

- [ ] **Step 3: Verify the deep-link/start-conversation paths still make sense**

The existing `?to=` deep-link (start a conversation with a specific user) + `?c=` selection still work. New office threads an operator starts remain participant threads; they also appear in the org-office list (same org). No change needed beyond confirming no regression (the operator's own started threads are a subset of the org's office threads).

- [ ] **Step 4: Verify + manual**

Run: `npx tsc --noEmit` + `npm run lint`. Manual (preview/local, two staff accounts in one org): a homeowner messages the office; admin A and manager B (neither necessarily the participant) both SEE the thread in their console and can reply; the homeowner sees both replies under "Cleaning office". A staff member of a DIFFERENT org does not see it.

- [ ] **Step 5: Commit**
```bash
git add src/components/redesign/messages/OperatorMessages.tsx
git commit -m "feat(messaging): operator console = org-scoped shared office inbox"
```

---

## Task 3: Integration test — org-office read + reply (RLS-backed)

**Files:**
- Create: a `*.integration.test.ts` (co-locate by the existing messaging integration test convention)

- [ ] **Step 1: Write the test**

Using the real helpers (service-role for setup; RLS user-clients for assertions): org A with admin A1, manager A2, homeowner H (member of A); an office conversation H<->A1 (`appointment_id NULL`, `organization_id` set via the 099 trigger by inserting a message). Assert with RLS clients:
1. Manager A2 (NOT a participant) can SELECT the office conversation (099 RLS) and, via the message read policy, read its messages.
2. Manager A2 can INSERT a reply message into that conversation (`sender_id = A2`, `recipient_id = H`, `organization_id = A`) -> succeeds (messages_insert branch 2).
3. A manager of org B cannot SELECT the conversation.
Match the existing integration-test helper signatures (read `conversations-org-office-rls.integration.test.ts` from 1a + `route.integration.test.ts`).

- [ ] **Step 2: Run in isolation -> GREEN.** `npm run test:integration -- <file>` (Supabase up). Confirm 3 assertions pass.

- [ ] **Step 3: Commit**
```bash
git add <test file>
git commit -m "test(messaging): operator org-office read + reply integration"
```

---

## Self-Review
- **Spec coverage:** §5.2 (org-scoped operator console; office threads team-replyable; replies attributed to the answerer; customer sees "Cleaning office"). Read-only JOB threads + booking panel are explicitly sub-project 2.
- **Non-regression:** `useConversations` `'office'`/`'job'` paths untouched (additive `'org-office'` mode + `orgId`); cleaner/homeowner unchanged. `can_view_messages` gate preserved.
- **Security:** org-office read is authorized by the 099 RLS; replies by `messages_insert` branch 2; the 100 hardening (separate PR) closes the customer foreign-org spoof. The operator reply path uses the operator's own org, so branch 2 applies.
- **Known follow-up:** a true shared-inbox unread model (the whole team's unread, not per-recipient) is out of scope; per-recipient unread is used. Note for a later polish.
