-- 067_reconcile_payments_cron.sql
-- pg_cron: every 15 minutes, POST /api/cron/reconcile-payments (CRON_SECRET-guarded) to run
-- the reconciliation sweep (Phase 4d): webhook dead-letter retry, stuck-payment reconcile,
-- failed-payout retry, and the money-math invariant check.
--
-- Safe to schedule immediately: the route 404s while STRIPE_ENABLED is off, so this is a
-- no-op heartbeat until Stripe is enabled.
--
-- Reuses the same app.* settings as migrations 064 + 066:
--   app.api_base_url — e.g. 'https://nexxus.example.com'
--   app.cron_secret  — matches the CRON_SECRET env var on the Next.js app

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-payments') THEN
    PERFORM cron.unschedule('reconcile-payments');
  END IF;
END $$;

SELECT cron.schedule(
  'reconcile-payments',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.api_base_url', true) || '/api/cron/reconcile-payments',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    )
  );
  $cmd$
);
