-- 052_messaging_permissions.sql
--
-- Server-side enforcement of the messaging permission matrix.
-- Mirror of src/lib/messagingPermissions.ts on the server.
--
-- Matrix:
--   admin     -> any role
--   manager   -> any role
--   cleaner   -> admin, manager
--   homeowner -> admin, manager
--
-- Closes the gap where the client matrix could be bypassed by calling
-- the get_or_create_conversation RPC or inserting into messages directly
-- with a hand-crafted recipient_id.

-- Pure matrix helper. Immutable so the planner can fold constants.
create or replace function public.can_message_role(viewer_role user_role, target_role user_role)
returns boolean
language sql
immutable
as $$
  select case viewer_role
    when 'admin'     then true
    when 'manager'   then true
    when 'cleaner'   then target_role in ('admin','manager')
    when 'homeowner' then target_role in ('admin','manager')
  end;
$$;

-- Look up both roles from auth context + target id and apply the matrix.
-- security definer so RLS on user_profiles can't hide the lookup from the caller.
create or replace function public.can_message_user(target_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer_role user_role;
  target_role user_role;
begin
  if auth.uid() is null then
    return false;
  end if;

  select role into viewer_role from user_profiles where id = auth.uid();
  select role into target_role from user_profiles where id = target_user_id;

  if viewer_role is null or target_role is null then
    return false;
  end if;

  return public.can_message_role(viewer_role, target_role);
end;
$$;

-- Make sure anon/authenticated can call the helper (they need to for the
-- RLS check below). It's a security definer fn so this is safe.
grant execute on function public.can_message_user(uuid) to anon, authenticated;
grant execute on function public.can_message_role(user_role, user_role) to anon, authenticated;

-- Gate the existing get_or_create_conversation RPC.
-- Preserves the existing participant-ordering logic; adds the matrix check
-- as the very first statement so disallowed pairs short-circuit before any
-- row is inserted.
create or replace function public.get_or_create_conversation(user1_id uuid, user2_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  conversation_id uuid;
  p1_id uuid;
  p2_id uuid;
begin
  -- Permission gate. Mirror of src/lib/messagingPermissions.ts.
  if not public.can_message_user(user2_id) then
    raise exception 'forbidden: messaging not permitted between these roles'
      using errcode = '42501';
  end if;

  -- Ensure participant_1_id < participant_2_id for consistency
  if user1_id < user2_id then
    p1_id := user1_id;
    p2_id := user2_id;
  else
    p1_id := user2_id;
    p2_id := user1_id;
  end if;

  -- Try to find existing conversation
  select id into conversation_id
  from conversations
  where participant_1_id = p1_id and participant_2_id = p2_id;

  -- If not found, create new conversation
  if conversation_id is null then
    insert into conversations (participant_1_id, participant_2_id)
    values (p1_id, p2_id)
    returning id into conversation_id;
  end if;

  return conversation_id;
end;
$$;

-- Belt-and-braces: tighten the messages INSERT policy so hand-crafted
-- inserts with a forbidden recipient also fail, regardless of which RPC
-- (or none) was used to create the parent conversation row.
drop policy if exists "Users can send messages" on public.messages;
create policy "Users can send messages"
  on public.messages
  for insert
  with check (
    auth.uid() = sender_id
    and public.can_message_user(recipient_id)
  );
