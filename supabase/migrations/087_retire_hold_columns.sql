-- 087_retire_hold_columns.sql
-- Charge-at-completion cleanup. Cards are SAVED (not held) at booking, so the columns that only
-- existed to drive the just-in-time card-hold lifecycle are now dead:
--   - appointments.authorize_at              (+ its partial index): scheduled the JIT authorizer cron
--   - appointments.cancellation_fee_captured: the cancellation fee now lives on the payments revenue
--                                             row + the payment_events ledger, not on the appointment
--
-- KEPT (still written/read by the charge-at-completion flow):
--   - appointments.authorization_status: now a coarse charge-outcome mirror (captured /
--       requires_action / failed) read by "Payments needing attention". The strict CHECK is dropped
--       because the value set is app-controlled and a stale constraint could reject a valid write.
--   - appointments.reauth_count: a generic charge-attempt counter for the idempotency key.
--   - payments.authorized_at / captured_at: charge/capture timestamps used by reconcile + settle.
--
-- Idempotent (IF EXISTS), and safe: no view, function, policy, or trigger references the dropped
-- columns (only migration 065 defined them).

-- Drop the strict authorization_status CHECK (keep the column).
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_authorization_status_chk;

-- Drop the JIT-authorizer scheduling column + its partial index.
DROP INDEX IF EXISTS appointments_authorize_at_idx;
ALTER TABLE public.appointments DROP COLUMN IF EXISTS authorize_at;

-- Drop the on-appointment cancellation-fee mirror (now on the payments row + ledger).
ALTER TABLE public.appointments DROP COLUMN IF EXISTS cancellation_fee_captured;
