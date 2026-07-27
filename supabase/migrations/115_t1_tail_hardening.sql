-- 115_t1_tail_hardening.sql
-- Tier-1 tail hardening bundle (audit T1-14 / T1-15 / T1-17).
--
-- (1) T1-17 · payments.manual_record_key — client idempotency key for the manual
--     "Record payment" route. Split/partial cash records are legitimate (product decision
--     2026-07-26), so the route cannot enforce one-revenue-row-per-appointment; instead each
--     form session sends a fresh UUID and the unique index makes a double-submit / network
--     retry of the SAME session replay the first row instead of inserting a duplicate that
--     double-counts revenue in payment_stats / admin_dashboard_stats.
--
-- (2) T1-14 · one OPEN incident per platform_alerts.alert_type — recordPlatformAlert's
--     select-then-insert dedupe raced under concurrency (two occurrences could produce two
--     rows, or one lost occurrence bump). The partial unique index makes the insert path
--     race-safe: the loser of a concurrent insert gets 23505 and folds its occurrence into
--     the winner's row. Existing duplicate open rows are resolved first (the newest-activity
--     row stays open) so the index can build on live data.
--
-- (3) T1-15(c) · stranded_refund_unwind_candidates v2 — two selection fixes:
--       - candidacy and failed_at now use the appointment's ABSOLUTE newest unwind failure,
--         not the newest one older than the cutoff. Before, an appointment whose live unwind
--         failed again seconds ago was still retried this sweep (measured from an older stale
--         failure), racing the live path; now a fresh failure defers the whole appointment
--         until it is stale.
--       - reconciler_attempts counts the worst single failure TYPE since the last marker
--         instead of all failure rows: one sweep that fails both the tenant and cleaner legs
--         used to count as 2 attempts and advance the exponential backoff twice.

-- ── (1) T1-17: manual-record idempotency key ────────────────────────────────────────────
alter table public.payments add column if not exists manual_record_key uuid;
comment on column public.payments.manual_record_key is
  'Client idempotency key for manual "Record payment" (audit T1-17). One per form session; the '
  'partial unique index dedupes double-submits while deliberate split/partial records (fresh key '
  'per session) stay unconstrained. NULL on every non-manual row.';
create unique index if not exists payments_manual_record_key_uniq
  on public.payments (manual_record_key)
  where manual_record_key is not null;

-- ── (2) T1-14: race-safe open-incident dedupe for platform alerts ───────────────────────
-- Fold pre-existing duplicate open incidents: keep the row with the newest activity open,
-- resolve the rest (they are occurrences of the same incident, not separate ones).
update public.platform_alerts pa
   set resolved_at = now()
 where pa.resolved_at is null
   and exists (
     select 1
       from public.platform_alerts newer
      where newer.alert_type = pa.alert_type
        and newer.resolved_at is null
        and (newer.last_seen_at > pa.last_seen_at
             or (newer.last_seen_at = pa.last_seen_at and newer.id > pa.id))
   );
create unique index if not exists platform_alerts_open_incident_uniq
  on public.platform_alerts (alert_type)
  where resolved_at is null;

-- ── (3) T1-15(c): candidate RPC v2 ──────────────────────────────────────────────────────
create or replace function public.stranded_refund_unwind_candidates(
  p_cutoff timestamptz,
  p_batch int
)
returns table (
  appointment_id uuid,
  organization_id uuid,
  payment_id uuid,
  failed_at timestamptz,
  reconciler_attempts int
)
language sql
security invoker
set search_path = public
as $$
  with newest_failure as (
    -- ABSOLUTE newest failure per appointment (v2: no cutoff inside this CTE). A failure
    -- fresher than the cutoff must defer the whole appointment below, not fall back to an
    -- older, stale failure row.
    select distinct on (pe.appointment_id)
           pe.appointment_id,
           pe.organization_id,
           pe.payment_id,
           pe.created_at as failed_at
      from public.payment_events pe
     where pe.event_type in ('transfer_reversal_failed', 'refund_clawback_failed', 'transfer_list_failed')
       and pe.appointment_id is not null
     order by pe.appointment_id, pe.created_at desc
  ),
  last_marker as (
    select m.appointment_id, max(m.created_at) as marked_at
      from public.payment_events m
     where m.event_type in ('refund_unwind_recovered', 'refund_unwind_manual_review')
     group by m.appointment_id
  )
  select nf.appointment_id,
         nf.organization_id,
         nf.payment_id,
         nf.failed_at,
         -- Worst single failure TYPE since the last marker ~= failed sweeps: a sweep that fails
         -- both legs appends one event per type, so max-per-type does not double-count it the
         -- way a flat count did (doubling the caller's exponential backoff twice per sweep).
         coalesce((
           select max(per_type.cnt)::int
             from (
               select count(*) as cnt
                 from public.payment_events a
                where a.appointment_id = nf.appointment_id
                  and a.event_type in ('transfer_reversal_failed', 'refund_clawback_failed', 'transfer_list_failed')
                  and a.actor = 'reconciler'
                  and a.created_at > coalesce(lm.marked_at, '-infinity'::timestamptz)
                group by a.event_type
             ) per_type
         ), 0) as reconciler_attempts
    from newest_failure nf
    left join last_marker lm on lm.appointment_id = nf.appointment_id
   where (lm.marked_at is null or lm.marked_at <= nf.failed_at)
     and nf.failed_at <= p_cutoff
   order by nf.failed_at asc
   limit p_batch;
$$;

-- Re-affirm grants (create or replace preserves ACLs, but keep a fresh database explicit):
-- server-only, the sole caller is the reconcile sweep on the service-role client.
revoke all on function public.stranded_refund_unwind_candidates(timestamptz, int) from public;
revoke all on function public.stranded_refund_unwind_candidates(timestamptz, int) from anon;
revoke all on function public.stranded_refund_unwind_candidates(timestamptz, int) from authenticated;
grant execute on function public.stranded_refund_unwind_candidates(timestamptz, int) to service_role;
