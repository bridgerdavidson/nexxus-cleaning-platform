-- Charge-at-completion hardening (payments audit findings C4 / H7 / M4 groundwork).
--
-- 1. ONE Stripe-backed revenue payment row per appointment, enforced by a partial unique
--    index. Every charge writer is check-then-insert, so two concurrent completions (or a
--    completion racing a webhook) could insert two rows; clawback/retry reads use limit(1)
--    and silently assume one. Manual cash records (payments/record: payment_type='revenue',
--    stripe_payment_intent_id NULL) are deliberately OUTSIDE the predicate so they can
--    coexist with a Stripe charge.
-- 2. ONE payout row per appointment (same race via concurrent settlement webhooks).
-- 3. payments.charge_kind: distinguishes the completion charge from the cancellation fee at
--    the DB level so the cancelled-job refund backstop (reconcile) can tell "refund this
--    debit" from "this fee legitimately settles to the tenant".
-- 4. refunds.initiator_user_id becomes nullable: the cancelled-inflight-debit auto-refund is
--    issued by the webhook/reconcile (no acting user).
-- 5. notification_events.dedupe_key + unique index: lets webhook-driven notifications upsert
--    with ignoreDuplicates so a reprocessed event can't double-notify. Full (non-partial)
--    index so PostgREST ON CONFLICT inference works; NULL keys stay unconstrained.
-- 6. Appointment status-transition guard: a cancelled appointment can never become
--    completed/in_progress (which would make it chargeable again after the cancel decision).

-- ── 3) charge kind ──────────────────────────────────────────────────────────────
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS charge_kind text
  CHECK (charge_kind IS NULL OR charge_kind IN ('completion', 'cancellation_fee'));

-- ── 4) system-issued refunds ────────────────────────────────────────────────────
ALTER TABLE public.refunds ALTER COLUMN initiator_user_id DROP NOT NULL;

-- ── 1) payments: de-dupe then enforce ───────────────────────────────────────────
-- Keep the best row per appointment among Stripe-backed revenue rows (paid > refunded >
-- processing > pending > failed, then newest); re-point children; delete the losers.
DO $$
DECLARE
  loser RECORD;
BEGIN
  FOR loser IN
    WITH ranked AS (
      SELECT id,
             first_value(id) OVER w AS keeper_id,
             row_number() OVER w AS rn
      FROM public.payments
      WHERE payment_type = 'revenue'
        AND stripe_payment_intent_id IS NOT NULL
        AND appointment_id IS NOT NULL
      WINDOW w AS (
        PARTITION BY appointment_id
        ORDER BY CASE status
                   WHEN 'paid' THEN 0
                   WHEN 'refunded' THEN 1
                   WHEN 'processing' THEN 2
                   WHEN 'pending' THEN 3
                   ELSE 4
                 END,
                 created_at DESC, id
      )
    )
    SELECT id, keeper_id FROM ranked WHERE rn > 1
  LOOP
    UPDATE public.refunds        SET payment_id = loser.keeper_id WHERE payment_id = loser.id;
    UPDATE public.payment_events SET payment_id = loser.keeper_id WHERE payment_id = loser.id;
    UPDATE public.disputes       SET payment_id = loser.keeper_id WHERE payment_id = loser.id;
    UPDATE public.invoices       SET payment_id = loser.keeper_id WHERE payment_id = loser.id;
    DELETE FROM public.payments WHERE id = loser.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_stripe_revenue_per_appt
  ON public.payments (appointment_id)
  WHERE payment_type = 'revenue'
    AND stripe_payment_intent_id IS NOT NULL
    AND appointment_id IS NOT NULL;

-- ── 2) payouts: detach duplicates then enforce ──────────────────────────────────
-- A duplicate payout row may carry a real stripe_transfer_id (money actually moved), so
-- losers are DETACHED (appointment_id -> NULL), never deleted: the forensic record and any
-- transfer id survive for manual remediation. Keeper preference: has a transfer id, then
-- bank_paid > paid > reversed > failed > pending, then newest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY appointment_id
           ORDER BY (stripe_transfer_id IS NOT NULL) DESC,
                    CASE status
                      WHEN 'bank_paid' THEN 0
                      WHEN 'paid' THEN 1
                      WHEN 'reversed' THEN 2
                      WHEN 'failed' THEN 3
                      ELSE 4
                    END,
                    created_at DESC, id
         ) AS rn
  FROM public.payouts
  WHERE appointment_id IS NOT NULL
)
UPDATE public.payouts p
SET appointment_id = NULL
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_payouts_per_appt
  ON public.payouts (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- ── 5) notification dedupe ──────────────────────────────────────────────────────
ALTER TABLE public.notification_events ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_notification_events_recipient_dedupe
  ON public.notification_events (recipient_user_id, dedupe_key);

-- ── 6) appointment status-transition guard ──────────────────────────────────────
-- completed -> cancelled stays ALLOWED: it is the administrative undo of a mistaken
-- completion, and the cancelled-inflight refund path depends on it. The reverse direction
-- would re-arm charging on a job someone decided not to pay for, so it is forbidden.
CREATE OR REPLACE FUNCTION public.guard_appointment_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cancelled' AND NEW.status IN ('completed', 'in_progress') THEN
    RAISE EXCEPTION 'invalid appointment status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointments_status_transition_guard ON public.appointments;
CREATE TRIGGER appointments_status_transition_guard
  BEFORE UPDATE OF status ON public.appointments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.guard_appointment_status_transition();
