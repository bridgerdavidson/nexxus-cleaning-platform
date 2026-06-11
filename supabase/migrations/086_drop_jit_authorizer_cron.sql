-- 086_drop_jit_authorizer_cron.sql
-- Charge-at-completion: cards are SAVED (not held) at booking and charged when the job is
-- completed, so the just-in-time authorizer + auth-expiry watchdog cron (migration 066) is
-- obsolete. The /api/cron/authorize-due route was deleted, so the job would only 404; remove the
-- dead heartbeat. Idempotent: a no-op if it was never scheduled (e.g. a fresh environment).
--
-- The reconcile-payments cron (067) stays as the settlement backstop.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jit-authorize-due') THEN
    PERFORM cron.unschedule('jit-authorize-due');
  END IF;
END $$;
