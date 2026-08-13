-- Re-key the org-staff SELECT policy on checklist_item_completions through the
-- appointment's organization instead of the row's own organization_id.
--
-- The row's organization_id is stamped CLIENT-SIDE by the cleaner's device
-- (useToggleChecklistItem sends currentOrganizationId ?? null). A null there
-- silently hid the row from every owner/admin/manager, which breaks the
-- operator live-progress view. The appointment row is server-authoritative
-- (appointments.organization_id is NOT NULL), so derive org membership from it.
--
-- The column and the client stamp stay (harmless, useful for forensics); it is
-- just no longer load-bearing for RLS.

drop policy if exists cic_org_read on public.checklist_item_completions;

create policy cic_org_read on public.checklist_item_completions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.appointments a
      join public.organization_members m
        on m.organization_id = a.organization_id
      where a.id = checklist_item_completions.appointment_id
        and m.user_id = (select auth.uid())
        and m.role = any (array['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
    )
  );
