-- 053_org_members_visibility.sql
--
-- Lets any organization member SELECT every membership row in their org(s).
-- Without this, RLS in prod only allowed self-rows, so useOrganizationMembers
-- returned just the caller and the New Conversation picker was empty for
-- non-admin/non-manager roles. Dev already had the policy and helper;
-- this brings prod into parity.

create or replace function public.get_user_organization_ids(check_user_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org_ids uuid[];
begin
  -- security definer so the policy that references this function does not
  -- recurse through organization_members RLS.
  select array_agg(organization_id) into org_ids
  from public.organization_members
  where user_id = check_user_id;

  return coalesce(org_ids, array[]::uuid[]);
end;
$$;

grant execute on function public.get_user_organization_ids(uuid) to anon, authenticated;

drop policy if exists "Users can view members of their organization" on public.organization_members;
create policy "Users can view members of their organization"
  on public.organization_members
  for select
  using (
    user_id = auth.uid()
    or organization_id = any (public.get_user_organization_ids(auth.uid()))
  );
