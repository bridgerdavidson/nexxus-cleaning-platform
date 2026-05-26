-- 066_jit_authorizer_cron.sql
-- pg_cron: every 15 minutes, POST /api/cron/authorize-due (CRON_SECRET-guarded) to run
-- the just-in-time authorizer + auth-expiry watchdog (Phase 2c, decision #13).
--
-- Safe to schedule immediately: the route 404s while STRIPE_NEW_CHARGE_FLOW_ENABLED is
-- off, so this is a no-op heartbeat until the flow is enabled.
--
-- Reuses the same app.* settings as migration 064:
--   app.api_base_url — e.g. 'https://nexxus.example.com'
--   app.cron_secret  — matches the CRON_SECRET env var on the Next.js app

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jit-authorize-due') THEN
    PERFORM cron.unschedule('jit-authorize-due');
  END IF;
END $$;

SELECT cron.schedule(
  'jit-authorize-due',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.api_base_url', true) || '/api/cron/authorize-due',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    )
  );
  $cmd$
);
