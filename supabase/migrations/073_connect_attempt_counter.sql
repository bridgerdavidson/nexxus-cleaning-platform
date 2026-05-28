-- 073_connect_attempt_counter.sql
-- Rotation key for stripe.accounts.create idempotency.
--
-- The /start routes pass `idempotencyKey: ${role}-connect-${id}-${env}` to
-- stripe.accounts.create as a backstop for the DB-side claim/commit guard.
-- Stripe caches the response for 24h. If a platform admin runs the Connect
-- reset on a tenant within that window, the next /start would replay the
-- cached create — Stripe would return the just-deleted account_id, /start
-- would commit it back, and the subsequent accountSessions.create() would
-- fail because the account no longer exists on Stripe's side.
--
-- The counter rotates the idempotency key: /start composes
-- `${role}-connect-${id}-${env}-${attempt}`, and the reset endpoint bumps
-- the counter before clearing the rest of the Connect state. The next
-- /start call uses a fresh key and gets a brand-new account.
--
-- ADDITIVE ONLY. Existing rows default to 0; the first attempt uses key
-- suffix `-0`, the first post-reset attempt uses `-1`, etc.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_connect_attempt_number integer NOT NULL DEFAULT 0;

ALTER TABLE public.cleaner_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_attempt_number integer NOT NULL DEFAULT 0;

COMMIT;
