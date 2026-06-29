-- Migration 097: homeowner live-tracking
-- Grants homeowners SELECT on checklist_item_completions for their own appointments,
-- enables realtime on that table, and adds started_at/completed_at to appointments
-- so the UI can compute elapsed time and later gate the job messaging grace window.

-- RLS: homeowner can read completions for their own appointments
drop policy if exists cic_homeowner_read on public.checklist_item_completions;
create policy cic_homeowner_read
  on public.checklist_item_completions
  for select
  to authenticated
  using (
    exists (
      select 1
      from appointments a
      where a.id = checklist_item_completions.appointment_id
        and a.homeowner_id = (select auth.uid())
    )
  );

-- Realtime: full row payload needed for INSERT/UPDATE events
alter table public.checklist_item_completions replica identity full;

-- Add to realtime publication (guard against duplicate-object error on re-run)
do $$ begin
  alter publication supabase_realtime add table public.checklist_item_completions;
exception when duplicate_object then null; end $$;

-- Appointment timing columns (used for elapsed-time display and job-messaging grace window)
alter table public.appointments add column if not exists started_at timestamptz;
alter table public.appointments add column if not exists completed_at timestamptz;
