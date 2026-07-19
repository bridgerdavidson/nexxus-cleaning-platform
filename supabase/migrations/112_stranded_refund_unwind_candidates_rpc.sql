-- 112_stranded_refund_unwind_candidates_rpc.sql
-- Candidate selection for the stranded refund-unwind retry sweep (audit T1-1,
-- retryStrandedRefundUnwinds in src/lib/payments/reconcile.ts).
--
-- Why a function instead of a PostgREST query: payment_events is APPEND-ONLY, so "this
-- appointment recovered" is a companion marker event, not a row update. A plain
-- newest-first LIMIT over failure rows starves: recovered appointments' failure rows
-- never leave the window, and one permanently-failing appointment appends fresh rows
-- every sweep until it owns every batch slot, silently locking all older stranded
-- appointments out of retry forever. The selection must therefore be
-- one-row-per-appointment with the recovered/manual-review exclusion applied BEFORE the
-- batch limit, ordered oldest-first for fairness - which needs DISTINCT ON + an
-- anti-join, neither expressible through the supabase-js filter builder.
--
-- Returns at most p_batch appointments whose NEWEST unwind-failure event
-- (transfer_reversal_failed / refund_clawback_failed / transfer_list_failed) is older
-- than p_cutoff and not superseded by a newer refund_unwind_recovered /
-- refund_unwind_manual_review marker. A marker tied exactly to the failure timestamp
-- retries (worst case: one idempotent no-op that writes a fresh marker).
-- reconciler_attempts counts sweep-actor failures since the last marker, for the
-- caller's retry backoff.

create index if not exists payment_events_type_appt_created_idx
  on public.payment_events (event_type, appointment_id, created_at desc);

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
    select distinct on (pe.appointment_id)
           pe.appointment_id,
           pe.organization_id,
           pe.payment_id,
           pe.created_at as failed_at
      from public.payment_events pe
     where pe.event_type in ('transfer_reversal_failed', 'refund_clawback_failed', 'transfer_list_failed')
       and pe.appointment_id is not null
       and pe.created_at <= p_cutoff
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
         (select count(*)::int
            from public.payment_events a
           where a.appointment_id = nf.appointment_id
             and a.event_type in ('transfer_reversal_failed', 'refund_clawback_failed', 'transfer_list_failed')
             and a.actor = 'reconciler'
             and a.created_at > coalesce(lm.marked_at, '-infinity'::timestamptz)
         ) as reconciler_attempts
    from newest_failure nf
    left join last_marker lm on lm.appointment_id = nf.appointment_id
   where lm.marked_at is null
      or lm.marked_at <= nf.failed_at
   order by nf.failed_at asc
   limit p_batch;
$$;

-- Server-only: the sole caller is the reconcile sweep on the service-role client.
revoke all on function public.stranded_refund_unwind_candidates(timestamptz, int) from public;
revoke all on function public.stranded_refund_unwind_candidates(timestamptz, int) from anon;
revoke all on function public.stranded_refund_unwind_candidates(timestamptz, int) from authenticated;
grant execute on function public.stranded_refund_unwind_candidates(timestamptz, int) to service_role;
