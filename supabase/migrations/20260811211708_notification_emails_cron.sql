-- notification_emails_cron (audit T2-1b, MASTER-TODO 3.5)
--
-- pg_cron: every 5 minutes, POST /api/cron/notification-emails (CRON_SECRET-guarded)
-- to drain the notification_events outbox to email. Today that is exactly the three
-- homeowner money receipts (charge_succeeded / refund_issued / cancellation_fee_charged)
-- that the T2-1 emits already write; the drain claims rows via email_dispatched_at.
--
-- Safe to schedule immediately: the route no-ops (and reports `skipped`) while the
-- five SMTP vars are unset, and claims nothing.
--
-- Reuses the same app.* settings as migrations 064/066/067:
--   app.api_base_url — e.g. 'https://nexxus.example.com'
--   app.cron_secret  — matches the CRON_SECRET env var on the Next.js app

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-emails') THEN
    PERFORM cron.unschedule('notification-emails');
  END IF;
END $$;

SELECT cron.schedule(
  'notification-emails',
  '*/5 * * * *',
  $cmd$
  SELECT net.http_post(
    url := current_setting('app.api_base_url', true) || '/api/cron/notification-emails',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
    )
  );
  $cmd$
);

-- One-time backfill: mark every money-receipt row that predates this migration as
-- already dispatched. These homeowners saw the in-app bell weeks ago; emailing a
-- backlog of stale receipts on first drain would read as a duplicate-charge scare.
-- Idempotent (re-run narrows to nothing); the known edge is that a reconciliation
-- re-apply would also swallow rows still queued at that moment, which is acceptable
-- for a receipt (the bell row remains).
UPDATE notification_events
   SET email_dispatched_at = now()
 WHERE event_type IN ('charge_succeeded', 'refund_issued', 'cancellation_fee_charged')
   AND email_dispatched_at IS NULL;
