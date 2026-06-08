-- 084_payout_attention_dismissed.sql
--
-- Lets an admin/manager DISMISS a failed cleaner-payout row from the Payments
-- "Needs attention" panel once they've handled it or confirmed it's stale, without
-- deleting the payout or losing the record that the cleaner is still owed.
--
-- Dismissal is purely a UI concern: the panel filters `attention_dismissed_at IS NULL`.
-- It does NOT change payout status and does NOT stop the reconciliation sweep
-- (retryFailedPayouts) from continuing to retry the transfer, so a dismissed-but-still
-- recoverable payout self-heals and the cleaner is never silently stranded.

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS attention_dismissed_at timestamptz;

COMMENT ON COLUMN public.payouts.attention_dismissed_at IS
  'When set, this payout is hidden from the Payments "Needs attention" panel (an admin acknowledged/handled it). UI-only: does not change payout status or stop the reconcile retry sweep.';
