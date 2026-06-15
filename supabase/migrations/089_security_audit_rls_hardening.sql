-- 089_security_audit_rls_hardening.sql
--
-- Security audit (2026-06-12) C4 + H3.
--
-- Root cause for the cross-tenant leaks: several consolidated policies (migrations
-- 074/075) and baseline policies carry a branch of the shape
--     ((auth.jwt() -> 'app_metadata' ->> 'role') = ANY('{admin,manager}'))
-- or  (EXISTS user_profiles up WHERE up.role IN ('admin','manager'))
-- with NO organization scope. `app_metadata.role` / `user_profiles.role` are the
-- per-user GLOBAL role (set for every org's admin/manager), so any tenant
-- admin/manager could read every other tenant's payments, appointments, messages,
-- user_profiles and organization_members. `cleaner_profiles` and `reviews` went
-- further with `USING (true)` for the `public` (anon) role.
--
-- This migration removes the global-role branch from each policy and replaces it
-- with an organization-scoped equivalent (the helper functions are all SECURITY
-- DEFINER, so referencing them inside these policies is recursion-safe). The
-- legitimate "see across all orgs" path remains via is_platform_admin().
--
-- It also revokes anon EXECUTE on the dashboard/mutation RPCs and binds
-- get_or_create_conversation to the calling user.

begin;

-- ── New helper: owner/admin (NOT manager) membership in a specific org.
-- SECURITY DEFINER so it can read organization_members from inside an
-- organization_members policy without RLS recursion. Used by the org_members
-- write policies so a global admin can no longer mutate another org's membership,
-- and a manager cannot self-escalate via membership inserts.
create or replace function public.is_owner_or_admin_in_org(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.organization_members om
    where om.user_id = (select auth.uid())
      and om.organization_id = check_org_id
      and om.role in ('owner', 'admin')
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- payments: staff access scoped to the payment's org (or the linked appointment's
-- org); plus the appointment parties; plus platform admin.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    (organization_id is not null and is_admin_or_manager_in_org(organization_id))
    or exists (
      select 1 from public.appointments a
      where a.id = payments.appointment_id
        and ( a.homeowner_id = (select auth.uid())
              or a.cleaner_id = (select auth.uid())
              or is_admin_or_manager_in_org(a.organization_id) )
    )
    or is_platform_admin((select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- appointments: drop the global-role branch from every command.
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    ((select auth.uid()) = homeowner_id)
    or ((select auth.uid()) = cleaner_id)
    or ((organization_id is not null) and is_admin_or_manager_in_org(organization_id))
    or user_shares_org_with_homeowner(homeowner_id)
    or is_platform_admin((select auth.uid()))
  );

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update to authenticated
  using (
    ((select auth.uid()) = homeowner_id)
    or ((select auth.uid()) = cleaner_id)
    or ((organization_id is not null) and is_admin_or_manager_in_org(organization_id))
    or user_shares_org_with_homeowner(homeowner_id)
  );

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert to authenticated
  with check (
    ((select auth.uid()) = homeowner_id)
    or ((organization_id is not null) and is_admin_or_manager_in_org(organization_id))
    or is_platform_admin((select auth.uid()))
  );

-- DELETE: keep the 083 recursion-safe shape (is_admin_or_manager_in_org is
-- SECURITY DEFINER), minus the global-role branch.
drop policy if exists appointments_delete on public.appointments;
create policy appointments_delete on public.appointments
  for delete to authenticated
  using (
    ((organization_id is not null) and is_admin_or_manager_in_org(organization_id))
    or is_platform_admin((select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- messages: conversation participants + sender/recipient; admin/manager read+send
-- now scoped to the message's own organization instead of globally.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    ((select auth.uid()) = sender_id)
    or ((select auth.uid()) = recipient_id)
    or ((organization_id is not null) and is_admin_or_manager_in_org(organization_id))
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and ((select auth.uid()) in (c.participant_1_id, c.participant_2_id))
    )
    or is_platform_admin((select auth.uid()))
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    (((select auth.uid()) = sender_id) and can_message_user(recipient_id))
    or (((select auth.uid()) = sender_id)
        and (organization_id is not null)
        and is_admin_or_manager_in_org(organization_id))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- user_profiles: drop the global-role branch; same-org visibility is already
-- provided by users_share_organization plus the appointment/conversation/message
-- relationship branches.
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (
    ((select auth.uid()) = id)
    or exists (
      select 1 from public.appointments a
      where a.homeowner_id = user_profiles.id and a.cleaner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.conversations c
      where ((c.participant_1_id = (select auth.uid()) and c.participant_2_id = user_profiles.id)
          or (c.participant_2_id = (select auth.uid()) and c.participant_1_id = user_profiles.id))
    )
    or exists (
      select 1 from public.messages m
      where ((m.sender_id = user_profiles.id and m.recipient_id = (select auth.uid()))
          or (m.recipient_id = user_profiles.id and m.sender_id = (select auth.uid())))
    )
    or users_share_organization((select auth.uid()), id)
    or is_platform_admin((select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- organization_members: drop the global user_profiles.role='admin'/'manager'
-- branches across all commands. Reads scoped to the caller's own orgs; writes to
-- owner/admin of the same org (or the org creator bootstrapping their own row).
drop policy if exists org_members_select on public.organization_members;
create policy org_members_select on public.organization_members
  for select to authenticated
  using (
    ((select auth.uid()) = user_id)
    or (organization_id = any (get_user_organization_ids((select auth.uid()))))
    or is_platform_admin((select auth.uid()))
  );

drop policy if exists org_members_insert on public.organization_members;
create policy org_members_insert on public.organization_members
  for insert to authenticated
  with check (
    is_owner_or_admin_in_org(organization_id)
    or (((select auth.uid()) = user_id) and exists (
      select 1 from public.organizations o
      where o.id = organization_members.organization_id
        and o.created_by = (select auth.uid())
    ))
    or is_platform_admin((select auth.uid()))
  );

drop policy if exists org_members_update on public.organization_members;
create policy org_members_update on public.organization_members
  for update to authenticated
  using (
    is_owner_or_admin_in_org(organization_id)
    or (user_id = (select auth.uid()))
    or is_platform_admin((select auth.uid()))
  );

drop policy if exists org_members_delete on public.organization_members;
create policy org_members_delete on public.organization_members
  for delete to authenticated
  using (
    is_owner_or_admin_in_org(organization_id)
    or (user_id = (select auth.uid()))
    or is_platform_admin((select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- cleaner_profiles: was `FOR SELECT TO public USING (true)` (anon-readable; leaked
-- stripe_connect_account_id, payout_percent, phone, email of every cleaner in every
-- org). Narrow to authenticated + same org. Drop the global manager UPDATE branch.
drop policy if exists cleaner_profiles_select on public.cleaner_profiles;
create policy cleaner_profiles_select on public.cleaner_profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (organization_id is not null and is_admin_or_manager_in_org(organization_id))
    or users_share_organization((select auth.uid()), id)
    or is_platform_admin((select auth.uid()))
  );

drop policy if exists cleaner_profiles_update on public.cleaner_profiles;
create policy cleaner_profiles_update on public.cleaner_profiles
  for update to authenticated
  using (
    ((select auth.uid()) = id)
    or can_admin_update_cleaner_profile((select auth.uid()), id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- reviews: was `FOR SELECT USING (true)` for `public` (anon-readable across all
-- tenants). Narrow to authenticated members of the review's org (+ the parties +
-- platform admin). The separate "platform admin can read reviews" policy remains.
drop policy if exists "Users can view reviews" on public.reviews;
create policy "Users can view reviews" on public.reviews
  for select to authenticated
  using (
    (organization_id is not null and organization_id = any (get_user_organization_ids((select auth.uid()))))
    or reviewer_id = (select auth.uid())
    or reviewee_id = (select auth.uid())
    or is_platform_admin((select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC hardening (H3).
--
-- Revoke anon EXECUTE on the dashboard/mutation RPCs. The stats RPCs are SECURITY
-- INVOKER and now rely on the hardened table RLS above (a non-member calling them
-- for another org gets RLS-filtered to nothing). bulk_update_cleaner_payouts is
-- SECURITY INVOKER and its UPDATE is gated by the (now org-scoped)
-- cleaner_profiles_update policy. Removing anon closes the unauthenticated path
-- that combined with the old USING(true) cleaner_profiles/reviews policies.
revoke execute on function public.admin_dashboard_stats(uuid) from anon;
revoke execute on function public.payment_stats(uuid) from anon;
revoke execute on function public.org_customers_with_counts(uuid) from anon;
revoke execute on function public.cleaner_stats(uuid, uuid) from anon;
revoke execute on function public.bulk_update_cleaner_payouts(jsonb) from anon;
revoke execute on function public.get_or_create_conversation(uuid, uuid) from anon;

-- get_or_create_conversation is SECURITY DEFINER (bypasses RLS). It trusted the
-- caller-supplied user1_id/user2_id, so a caller could create a conversation row
-- attributed to two other users. Require the caller to be one of the participants.
create or replace function public.get_or_create_conversation(user1_id uuid, user2_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  conversation_id uuid;
  p1_id uuid;
  p2_id uuid;
begin
  if (select auth.uid()) is null
     or ((select auth.uid()) <> user1_id and (select auth.uid()) <> user2_id) then
    raise exception 'forbidden: cannot create a conversation you are not part of'
      using errcode = '42501';
  end if;

  if not public.can_message_user(user2_id) then
    raise exception 'forbidden: messaging not permitted between these roles'
      using errcode = '42501';
  end if;

  if user1_id < user2_id then
    p1_id := user1_id;
    p2_id := user2_id;
  else
    p1_id := user2_id;
    p2_id := user1_id;
  end if;

  select id into conversation_id
  from conversations
  where participant_1_id = p1_id and participant_2_id = p2_id;

  if conversation_id is null then
    insert into conversations (participant_1_id, participant_2_id)
    values (p1_id, p2_id)
    returning id into conversation_id;
  end if;

  return conversation_id;
end;
$function$;

commit;
