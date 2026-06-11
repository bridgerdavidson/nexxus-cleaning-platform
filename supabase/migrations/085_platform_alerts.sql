-- ═════════════════════════════════════════════════════════════════════════════
-- 085_platform_alerts — platform-owner operational alert outbox
-- ─────────────────────────────────────────────────────────────────────────────
-- When something only the platform OWNER (Nexxus staff) can fix breaks — e.g.
-- transactional email failing at the SMTP layer (the provider rejecting GoTrue's
-- login, "535 5.7.8 Authentication failed") — we record one row here.
--
-- Deliberately NOT org-scoped: these are infra alerts for the platform owner, not
-- tenant-facing notifications, so they do not belong in notification_events. Only
-- the service role writes; platform admins may read (for a future /owner view).
--
-- The webhook_dispatched_at / sms_dispatched_at columns mirror the
-- notification_events outbox: they are the seam for a future dispatcher (cron) that
-- texts the owner. Wiring an SMS provider is the only remaining work for that — the
-- row + columns already exist. See src/lib/monitoring/platformAlert.ts.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.platform_alerts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type            text NOT NULL,                       -- stable key, e.g. 'auth_email_send_failure'
  severity              text NOT NULL DEFAULT 'critical',    -- 'info' | 'warning' | 'critical'
  summary               text NOT NULL,                       -- one-line human summary
  details               jsonb NOT NULL DEFAULT '{}'::jsonb,  -- structured context (no secrets)
  occurrences           integer NOT NULL DEFAULT 1,          -- bumped on de-dupe within the window
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,                         -- set when the incident is cleared
  -- dispatcher seams (written only by a future dispatcher, like notification_events.*_dispatched_at)
  webhook_dispatched_at timestamptz,
  sms_dispatched_at     timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Open-incident / de-dupe lookup: newest unresolved row of a given type.
CREATE INDEX IF NOT EXISTS idx_platform_alerts_open
  ON public.platform_alerts (alert_type, last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- Future SMS dispatcher: rows it still has to deliver.
CREATE INDEX IF NOT EXISTS idx_platform_alerts_pending_sms
  ON public.platform_alerts (last_seen_at)
  WHERE sms_dispatched_at IS NULL;

-- RLS on. Service role (bypasses RLS) writes. Platform admins may read so a future
-- /owner back-office can list alerts; everyone else gets nothing. Reuses the
-- is_platform_admin predicate from migration 068; auth.uid() is wrapped in a
-- subselect per the migration-074 RLS-initplan convention.
ALTER TABLE public.platform_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_alerts_read_admin ON public.platform_alerts
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin((select auth.uid())));
