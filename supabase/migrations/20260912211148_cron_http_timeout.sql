-- cron_http_timeout: give the pg_cron -> app HTTP calls a 60s pg_net timeout
--
-- The three jobs from 20260812024230_cron_config_vault call net.http_post without
-- timeout_milliseconds, so pg_net used its 5s default. A sweep that simply takes longer
-- than 5s (reconcile-payments does many queries plus Stripe calls, and since Sep 2026 the
-- Supabase v2 API gateway adds 1.5-6s to the first query after idle) was recorded in
-- net._http_response as "Timeout of 5000 ms reached" even though the route kept running
-- and returned 200. That made the job history useless for telling real failures from
-- slow successes. 60s comfortably covers a normal run, so the recorded status is real.
--
-- Same names, schedules, and commands as before; only timeout_milliseconds is added.
-- cron.schedule() with an existing job name updates that job in place, so this is
-- idempotent and keeps each job's id and run history.

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
    ),
    timeout_milliseconds := 60000
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
    ),
    timeout_milliseconds := 60000
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
    ),
    timeout_milliseconds := 60000
  )
  WHERE (SELECT count(*) FROM vault.decrypted_secrets WHERE name IN ('app_base_url', 'cron_secret')) = 2;
  $cmd$
);
