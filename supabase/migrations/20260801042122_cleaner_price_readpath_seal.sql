-- cleaner_price_readpath_seal
--
-- Close the pay-request pilot blocker documented on PR #221: RLS is row-level,
-- so the assigned cleaner could read `appointments.total_price` (and
-- `payments.amount`, and `recurring_appointment_series.total_price`) directly
-- with their own session token, which let a request-mode cleaner compute the
-- auto-approve cap exactly and made migration 119's price-seal cosmetic.
--
-- WHAT THIS DOES
-- 1. Three SECURITY DEFINER helpers that answer "is the caller the assigned
--    cleaner of X" WITHOUT reading appointments under the caller's RLS. Policy
--    subqueries evaluate the referenced table's own policies (the recursion
--    class 078/083 fixed the same way), so every dependent policy below must
--    switch to a helper BEFORE the cleaner's SELECT arm can be removed.
-- 2. Rewrites the dependent policies (job photos, checklist completions,
--    requested slots, routing log, properties, homeowner profiles, reviews) to
--    use the helpers. Cleaner-facing behavior is unchanged.
-- 3. Removes the cleaner arm from appointments_select, payments_select and
--    recurring_series_select. The cleaner's replacement read paths are the
--    service-role routes GET /api/cleaner/appointments and
--    GET /api/cleaner/earnings (price-free projections), mirroring
--    /api/pay-requests/mine from 119.
-- 4. Recreates cleaner_stats as a self-authorizing SECURITY DEFINER function
--    (it was SECURITY INVOKER, so step 3 would have silently zeroed every
--    dashboard tile) and makes its earnings payout-row-based for flat/request
--    cleaners. The old percent-based estimate was both wrong for those modes
--    and let a one-job request cleaner divide the estimate by their percent to
--    recover the sealed price.
--
-- The cleaner's UPDATE arm on appointments is removed too, deliberately: in
-- Postgres an UPDATE's WHERE clause requires SELECT rights on the existing
-- row, so with the SELECT arm gone a cleaner UPDATE silently matches zero
-- rows no matter what the UPDATE policy says. Keeping the arm would only
-- disguise a dead code path. Cleaner status/progress writes move to
-- POST /api/cleaner/appointments/[appointmentId]/status (service role,
-- verifies the assignment, allows only status/job_progress), joining the
-- offer-confirm and photo-skip routes that were already server-side.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SECURITY DEFINER helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_assigned_cleaner(p_appointment_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.id = p_appointment_id
      and a.cleaner_id = (select auth.uid())
  );
$$;

comment on function public.is_assigned_cleaner(uuid) is
  'SECURITY DEFINER: is the current user the assigned cleaner of this appointment. Lets dependent policies (job_photos, checklist_item_completions, requested slots, routing log, reviews) keep working after this migration removed the cleaner SELECT arm on appointments.';

create or replace function public.cleans_for_homeowner(p_homeowner_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.homeowner_id = p_homeowner_id
      and a.cleaner_id = (select auth.uid())
  );
$$;

comment on function public.cleans_for_homeowner(uuid) is
  'SECURITY DEFINER: does the current user clean (any appointment) for this homeowner. Replaces the appointments subquery in user_profiles_select.';

create or replace function public.cleans_property(p_property_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.property_id = p_property_id
      and a.cleaner_id = (select auth.uid())
  );
$$;

comment on function public.cleans_property(uuid) is
  'SECURITY DEFINER: does the current user have an appointment at this property. Replaces the appointments subquery in properties_select.';

revoke all on function public.is_assigned_cleaner(uuid) from public, anon;
revoke all on function public.cleans_for_homeowner(uuid) from public, anon;
revoke all on function public.cleans_property(uuid) from public, anon;
grant execute on function public.is_assigned_cleaner(uuid) to authenticated;
grant execute on function public.cleans_for_homeowner(uuid) to authenticated;
grant execute on function public.cleans_property(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Dependent policies: same access, evaluated via the helpers
-- ─────────────────────────────────────────────────────────────────────────────

-- job_photos (baseline policies; photo capture/gallery for the assigned cleaner)
drop policy if exists "Cleaners can view own appointment photos" on public.job_photos;
create policy "Cleaners can view own appointment photos" on public.job_photos
  for select to authenticated
  using (public.is_assigned_cleaner(job_photos.appointment_id));

drop policy if exists "Cleaners can insert own appointment photos" on public.job_photos;
create policy "Cleaners can insert own appointment photos" on public.job_photos
  for insert to authenticated
  with check (public.is_assigned_cleaner(job_photos.appointment_id));

drop policy if exists "Cleaners can delete own appointment photos" on public.job_photos;
create policy "Cleaners can delete own appointment photos" on public.job_photos
  for delete to authenticated
  using (public.is_assigned_cleaner(job_photos.appointment_id));

-- checklist_item_completions (095; the active-job checklist)
drop policy if exists cic_cleaner_rw on public.checklist_item_completions;
create policy cic_cleaner_rw on public.checklist_item_completions
  for all to authenticated
  using (public.is_assigned_cleaner(checklist_item_completions.appointment_id))
  with check (public.is_assigned_cleaner(checklist_item_completions.appointment_id));

-- appointment_requested_slots (076; the multi-slot offer chips)
drop policy if exists "appointment_requested_slots_select" on public.appointment_requested_slots;
create policy "appointment_requested_slots_select" on public.appointment_requested_slots
  for select to authenticated
  using (
    public.is_assigned_cleaner(appointment_requested_slots.appointment_id)
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_requested_slots.appointment_id
        and (a.homeowner_id = (select auth.uid())
             or (a.organization_id is not null and public.is_admin_or_manager_in_org(a.organization_id)))
    )
  );

-- appointment_routing_log (076)
drop policy if exists "appointment_routing_log_select" on public.appointment_routing_log;
create policy "appointment_routing_log_select" on public.appointment_routing_log
  for select to authenticated
  using (
    appointment_routing_log.cleaner_id = (select auth.uid())
    or public.is_assigned_cleaner(appointment_routing_log.appointment_id)
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_routing_log.appointment_id
        and (a.homeowner_id = (select auth.uid())
             or (a.organization_id is not null and public.is_admin_or_manager_in_org(a.organization_id)))
    )
  );

-- properties_select (077 shape; only the cleaner subquery changes)
drop policy if exists "properties_select" on public.properties;
create policy "properties_select" on public.properties
  for select to authenticated
  using (
    (select auth.uid()) = owner_id
    or exists (
      select 1 from public.organization_members om_viewer
      where om_viewer.user_id = (select auth.uid())
        and om_viewer.role = any (array['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
        and exists (
          select 1 from public.organization_members om_target
          where om_target.user_id = properties.owner_id
            and om_target.role = 'homeowner'::public.org_role
            and om_target.organization_id = om_viewer.organization_id
        )
    )
    or public.cleans_property(properties.id)
    or exists (
      select 1 from public.user_profiles up
      where up.id = (select auth.uid())
        and up.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
    or public.is_platform_admin((select auth.uid()))
    -- self-pay: org owner/admin/manager can view org-owned (null-owner) properties
    or (
      properties.owner_id is null
      and exists (
        select 1 from public.organization_members om_self
        where om_self.user_id = (select auth.uid())
          and om_self.organization_id = properties.organization_id
          and om_self.role = any (array['owner'::public.org_role, 'admin'::public.org_role, 'manager'::public.org_role])
      )
    )
  );

-- user_profiles_select (089 shape; only the appointments subquery changes)
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (
    ((select auth.uid()) = id)
    or public.cleans_for_homeowner(user_profiles.id)
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

-- reviews: both appointment parties may write a review; the cleaner side now
-- resolves via the helper (baseline policy shape otherwise)
drop policy if exists "Users can create reviews for their appointments" on public.reviews;
create policy "Users can create reviews for their appointments" on public.reviews
  for insert to authenticated
  with check (
    ((select auth.uid()) = reviewer_id)
    and (
      exists (
        select 1 from public.appointments a
        where a.id = reviews.appointment_id
          and a.homeowner_id = (select auth.uid())
      )
      or public.is_assigned_cleaner(reviews.appointment_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The seal: remove the cleaner SELECT arms
-- ─────────────────────────────────────────────────────────────────────────────

-- appointments_select (089 shape minus the cleaner arm).
-- user_shares_org_with_homeowner requires org role owner/admin/manager, so it
-- cannot re-grant a cleaner what this removes.
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    ((select auth.uid()) = homeowner_id)
    or ((organization_id is not null) and is_admin_or_manager_in_org(organization_id))
    or user_shares_org_with_homeowner(homeowner_id)
    or is_platform_admin((select auth.uid()))
  );

-- appointments_update (106 shape minus the cleaner arm; see the header note on
-- why the arm is dead once SELECT is gone).
drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update to authenticated
  using (
    ((select auth.uid()) = homeowner_id)
    or ((organization_id is not null) and public.can_write_org_appointments(organization_id))
    or public.can_write_appointments_for_homeowner(homeowner_id)
  );

-- payments_select (089 shape minus the cleaner arm): payments.amount is the
-- full customer charge, i.e. the same sealed number through a different table.
-- The cleaner's clearing/held money now comes from GET /api/cleaner/earnings.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    (organization_id is not null and is_admin_or_manager_in_org(organization_id))
    or exists (
      select 1 from public.appointments a
      where a.id = payments.appointment_id
        and ( a.homeowner_id = (select auth.uid())
              or is_admin_or_manager_in_org(a.organization_id) )
    )
    or is_platform_admin((select auth.uid()))
  );

-- recurring_series_select (075 shape minus the cleaner arm): series rows carry
-- total_price / price_override_total. The cleaner's series offers render from
-- their own appointment occurrences, never from the series row.
drop policy if exists "recurring_series_select" on public.recurring_appointment_series;
create policy "recurring_series_select" on public.recurring_appointment_series
  for select to authenticated
  using (
    exists (select 1 from public.organization_members om where om.organization_id = recurring_appointment_series.organization_id and om.user_id = (select auth.uid()) and (om.role = 'admin'::public.org_role or om.role = 'owner'::public.org_role))
    or homeowner_id = (select auth.uid())
    or exists (select 1 from public.organization_members om join public.manager_permissions mp on om.user_id = mp.manager_id where om.organization_id = recurring_appointment_series.organization_id and om.user_id = (select auth.uid()) and om.role = 'manager'::public.org_role and mp.can_view_bookings = true)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. cleaner_stats: DEFINER + self-authorizing + mode-aware earnings
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cleaner_stats(p_cleaner_id uuid, p_org_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_caller uuid;
  v_caller_role text;
  v_allowed boolean := false;
  v_payout_percent numeric;
  v_payout_model text;
  v_total_jobs bigint;
  v_completed_jobs bigint;
  v_upcoming_jobs bigint;
  v_completed_this_week bigint;
  v_total_earnings_gross numeric;
  v_paid_amount numeric;
  v_cleaner_earnings numeric;
  v_pending numeric;
begin
  -- DEFINER requires its own gate: the cleaner themself, org owner/admin, or a
  -- manager with can_manage_cleaners or can_view_payments. Anyone else gets the
  -- same error as a missing profile (don't reveal existence).
  v_caller := auth.uid();
  if v_caller is not null and v_caller = p_cleaner_id then
    v_allowed := true;
  elsif v_caller is not null then
    select om.role into v_caller_role
      from organization_members om
      where om.organization_id = p_org_id and om.user_id = v_caller;
    if v_caller_role in ('owner', 'admin') then
      v_allowed := true;
    elsif v_caller_role = 'manager' then
      select coalesce(mp.can_manage_cleaners, false) or coalesce(mp.can_view_payments, false)
        into v_allowed
        from manager_permissions mp
        where mp.organization_id = p_org_id and mp.manager_id = v_caller;
    end if;
  end if;
  if not coalesce(v_allowed, false) then
    raise exception 'cleaner profile not found' using errcode = 'PGRST116';
  end if;

  select coalesce(payout_percent, 0),
         case when payout_model = 'percentage_contractor' then 'percentage'
              else coalesce(payout_model, 'percentage') end
    into v_payout_percent, v_payout_model
    from cleaner_profiles
    where id = p_cleaner_id and organization_id = p_org_id;

  if not found then
    raise exception 'cleaner profile not found' using errcode = 'PGRST116';
  end if;

  select count(*) into v_total_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id;

  select count(*) into v_completed_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id and status = 'completed';

  select count(*) into v_upcoming_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id
      and status in ('pending', 'confirmed', 'in_progress');

  select count(*) into v_completed_this_week
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id
      and status = 'completed'
      and scheduled_date >= (current_date - interval '7 days');

  if v_payout_model = 'percentage' then
    -- Legacy estimate, unchanged for percentage cleaners.
    select coalesce(sum(total_price), 0) into v_total_earnings_gross
      from appointments
      where cleaner_id = p_cleaner_id and organization_id = p_org_id and status = 'completed';

    v_cleaner_earnings := v_total_earnings_gross * (v_payout_percent / 100.0);

    select coalesce(sum(p.amount), 0) into v_paid_amount
      from payments p
      join appointments a on a.id = p.appointment_id
      where a.cleaner_id = p_cleaner_id
        and a.organization_id = p_org_id
        and a.status = 'completed'
        and p.status = 'paid';

    v_pending := greatest(0, v_cleaner_earnings - v_paid_amount);
  else
    -- flat / request / hourly_external: the percent estimate is wrong for these
    -- modes, and worse, it let a request cleaner divide the estimate by their
    -- percent to recover the sealed job price. Their payout rows are their real
    -- money (payouts.amount is dollars and is the cleaner's own cut):
    -- earned = everything not clawed back; pending = not yet in their bank.
    select coalesce(sum(amount), 0) into v_cleaner_earnings
      from payouts
      where cleaner_id = p_cleaner_id and organization_id = p_org_id
        and status <> 'reversed';

    select coalesce(sum(amount), 0) into v_pending
      from payouts
      where cleaner_id = p_cleaner_id and organization_id = p_org_id
        and status in ('pending', 'approved', 'failed');
  end if;

  return jsonb_build_object(
    'totalJobs', v_total_jobs,
    'completedJobs', v_completed_jobs,
    'upcomingJobs', v_upcoming_jobs,
    'completedThisWeek', v_completed_this_week,
    'totalEarnings', round(v_cleaner_earnings),
    'pendingPayouts', round(v_pending)
  );
end;
$$;

-- ACLs carry over on CREATE OR REPLACE (089 already revoked anon EXECUTE), but
-- re-assert since the function is DEFINER now.
revoke execute on function public.cleaner_stats(uuid, uuid) from anon;
grant execute on function public.cleaner_stats(uuid, uuid) to authenticated;
