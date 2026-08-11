-- T2-11 (payments audit v4) + the T2-3 residual · payment_stats precision + refund netting
--
-- 077's payment_stats rounded every stat to WHOLE dollars while the Payments KPI tiles
-- display cents (money2) → phantom reconciliation drift of up to 50¢ per stat against the
-- ledger. It also never netted partial refunds: a FULL refund flips payments.status to
-- 'refunded' (dropping the row from the status='paid' sum entirely), but a PARTIAL refund
-- leaves the row 'paid' at its full amount, overstating revenue by the refunded portion.
--
-- This version:
--   • computes everything in integer CENTS. payments.amount is numeric(10,2), so
--     round(amount * 100) is exact; refunds.amount is already cents (bigint).
--   • nets 'pending' + 'succeeded' refunds per payment, capped at the payment amount
--     (greatest(..., 0)). Mirrors the ledger's deriveRefunds.ts exactly: failed/canceled
--     refunds returned nothing so they must not reduce revenue, and a fully-refunded row
--     is excluded by status so its refunds are never double-subtracted.
--   • attributes a refund to the PAYMENT's month (p.created_at), not the refund's, so the
--     per-row ledger math and the this-month KPI always agree.
--   • returns the new integer-cents contract (totalRevenueCents, pendingPayoutsCents,
--     thisMonthRevenueCents) PLUS the legacy dollar keys, now cents-precise instead of
--     whole-dollar rounded. The dollar keys exist only for clients built before this
--     migration (shared-dev previews + the prod deploy/migrate race); new code reads the
--     *Cents keys. Drop the dollar keys in a later cleanup once nothing deployed reads them.
--
-- Same signature as 077 ⇒ CREATE OR REPLACE preserves the existing grants (089 revoked
-- anon). Stays SECURITY INVOKER: callers are org staff (owner/admin/manager), who hold
-- RLS SELECT on payments, payouts, and refunds ("org staff read refunds", 065).

CREATE OR REPLACE FUNCTION "public"."payment_stats"("p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_total_cents bigint;
  v_month_cents bigint;
  v_pending_payout_cents bigint;
  v_first_of_month timestamptz := date_trunc('month', now());
begin
  select
    coalesce(sum(n.net_cents), 0),
    coalesce(sum(n.net_cents) filter (where n.created_at >= v_first_of_month), 0)
  into v_total_cents, v_month_cents
  from (
    select
      p.created_at,
      greatest(
        round(p.amount * 100)::bigint
          - coalesce((select sum(r.amount)
                        from refunds r
                       where r.payment_id = p.id
                         and r.status in ('pending', 'succeeded')), 0),
        0
      ) as net_cents
    from payments p
    where p.organization_id = p_org_id
      and p.status = 'paid'
      and p.payment_type = 'revenue'
      and p.is_self_pay = false
  ) n;

  select coalesce(round(sum(amount) * 100), 0)::bigint into v_pending_payout_cents
    from payouts
    where organization_id = p_org_id and status = 'pending';

  return jsonb_build_object(
    'totalRevenueCents', v_total_cents,
    'pendingPayoutsCents', v_pending_payout_cents,
    'thisMonthRevenueCents', v_month_cents,
    'totalRevenue', v_total_cents / 100.0,
    'pendingPayouts', v_pending_payout_cents / 100.0,
    'thisMonthRevenue', v_month_cents / 100.0
  );
end;
$$;
