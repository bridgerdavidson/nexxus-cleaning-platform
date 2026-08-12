-- cron_config_vault: move pg_cron HTTP config from app.* GUCs to Supabase Vault
--
-- The 064/066/067 (and 20260811211708) cron jobs read current_setting('app.api_base_url')
-- and current_setting('app.cron_secret'), with setup documented as ALTER SYSTEM / ALTER
-- DATABASE SET. That only ever worked on LOCAL Supabase, where the postgres role is a
-- superuser. On hosted projects the postgres role is NOT superuser and Postgres 15+
-- denies it custom-GUC writes at database level (42501: "permission denied to set
-- parameter"), so these settings were never configurable in dev or prod, and none of the
-- cron-driven routes has ever fired outside local. Discovered 2026-08-11 while arming the
-- crons for the first time.
--
-- Fix: each job reads the base URL + secret from Vault at run time. Provision per
-- environment (one-time, SQL editor; both must exist or every tick no-ops silently):
--
--   SELECT vault.create_secret('<the CRON_SECRET value>', 'cron_secret');
--   SELECT vault.create_secret('https://cleaning.trynexxus.com', 'app_base_url');
--
-- (To change later: vault.update_secret(id, ...) with the id from vault.secrets.)
--
-- Also unschedules 066's jit-authorize-due: its target route /api/cron/authorize-due was
-- deleted when the card-hold model was replaced by charge-at-completion, so the job could
-- only ever 404.

CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

DO $$
DECLARE
  j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['jit-authorize-due', 'auto-defer-sweep', 'reconcile-payments', 'notification-emails'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN
      PERFORM cron.unschedule(j);
    END IF;
  END LOOP;
END $$;

-- The WHERE guard makes an unprovisioned environment (fresh local, shared dev before
-- Vault setup) a clean no-op instead of a NULL-url error in cron.job_run_details.

SELECT cron.schedule(
  'auto-defer-sweep',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_base_url')
           || '/api/appointments/auto-defer/cron',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    )
  )
  WHERE (SELECT count(*) FROM vault.decrypted_secrets WHERE name IN ('app_base_url', 'cron_secret')) = 2;
  $cmd$
);

SELECT cron.schedule(
  'reconcile-payments',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_base_url')
           || '/api/cron/reconcile-payments',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    )
  )
  WHERE (SELECT count(*) FROM vault.decrypted_secrets WHERE name IN ('app_base_url', 'cron_secret')) = 2;
  $cmd$
);

SELECT cron.schedule(
  'notification-emails',
  '*/5 * * * *',
  $cmd$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_base_url')
           || '/api/cron/notification-emails',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    )
  )
  WHERE (SELECT count(*) FROM vault.decrypted_secrets WHERE name IN ('app_base_url', 'cron_secret')) = 2;
  $cmd$
);
