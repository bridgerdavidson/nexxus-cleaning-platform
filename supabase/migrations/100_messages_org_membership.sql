-- 100_messages_org_membership.sql
-- Security hardening: require a message sender to be a member of the org they
-- stamp on the row.
--
-- messages.organization_id is client-supplied. The messages_insert policy (089)
-- first (customer) branch validated only `auth.uid() = sender_id AND
-- can_message_user(recipient_id)` — it did NOT check that organization_id matches
-- the sender's org membership. A customer (homeowner/cleaner) could therefore
-- insert a message carrying a FOREIGN organization_id; migration 099's trigger
-- then stamps that conversation with the foreign org, and
-- conversations_select_org_office exposes the conversation row metadata to that
-- foreign org's staff.
--
-- Fix: add `organization_id is not null AND is_org_member(organization_id)` to the
-- first branch only. The second (admin/manager) branch already scopes by
-- is_admin_or_manager_in_org and is left unchanged.

-- ─────────────────────────────────────────────────────────────────────────────
-- New helper: membership in a specific org under ANY org role. Mirrors
-- is_admin_or_manager_in_org / is_owner_or_admin_in_org (089) but role-agnostic.
-- SECURITY DEFINER so it can read organization_members from inside a messages
-- policy without organization_members RLS recursion.
create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  return exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = check_org_id
  );
end;
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- messages: recreate messages_insert. Branch 1 (customer) now also requires the
-- sender to be a member of the message's organization_id. Branch 2 (admin/
-- manager) is unchanged.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    (((select auth.uid()) = sender_id)
      and can_message_user(recipient_id)
      and (organization_id is not null)
      and public.is_org_member(organization_id))
    or (((select auth.uid()) = sender_id)
        and (organization_id is not null)
        and is_admin_or_manager_in_org(organization_id))
  );
