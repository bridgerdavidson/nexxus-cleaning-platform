-- pg_cron-driven sweep: every 15 minutes, POST to /api/appointments/auto-defer/cron
-- and let the existing routing logic process expired deadlines + emit
-- notification_events rows.
--
-- Replaces (well, augments) the opportunistic dashboard-load polling. The
-- opportunistic fire-on-mount in useAdminActionItems is kept as
-- belt-and-suspenders: pg_cron handles the long tail, dashboard-load handles
-- the case where the admin opens the page right after a deadline passes.
--
-- Required environment config (set via `ALTER SYSTEM SET` in prod, or via
-- supabase/seed.sql for local dev):
--   app.api_base_url   — e.g. 'https://nexxus.example.com'
--   app.cron_secret    — matches the CRON_SECRET env var on the Next.js app

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any previous version of this job (idempotent for re-runs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-defer-sweep') THEN
    PERFORM cron.unschedule('auto-defer-sweep');
  END IF;
END $$;

SELECT cron.schedule(
  'auto-defer-sweep',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.api_base_url', true) || '/api/appointments/auto-defer/cron',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    )
  );
  $cmd$
);
