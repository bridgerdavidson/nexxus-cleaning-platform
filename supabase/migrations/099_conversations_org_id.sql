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
