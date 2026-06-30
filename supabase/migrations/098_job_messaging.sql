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
