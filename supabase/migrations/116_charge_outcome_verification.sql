-- 116_charge_outcome_verification.sql
-- Audit T1-16: a completion charge that Stripe CAPTURED but whose response was lost gets recorded
-- as a `failed` revenue row with stripe_payment_intent_id NULL (recordChargeDecline's
-- unknown-outcome branch). The money sits on the platform balance with no reconciliation, and an
-- operator "Retry charge" would mint a fresh idempotency key and charge a SECOND time.
--
-- charge_outcome_verified_at is the verification stamp for that shape: NULL means "outcome
-- unknown, do NOT issue a fresh charge" (chargeCompletedAppointment blocks with
-- outcome_verification_pending); the verifyUnknownChargeOutcomes sweep job either repairs the row
-- from the PaymentIntent it finds at Stripe (metadata search) or, when Stripe confirms no charge
-- exists, stamps this column so retries unblock. Rows outside the unknown-outcome shape never
-- consult it.
alter table public.payments add column if not exists charge_outcome_verified_at timestamptz;
comment on column public.payments.charge_outcome_verified_at is
  'T1-16: when the reconcile sweep confirmed this failed PI-less completion row against Stripe '
  '(no captured charge exists, or the row was repaired). NULL on a failed card completion row '
  'with no PaymentIntent means the outcome is unverified and fresh charges are blocked.';
