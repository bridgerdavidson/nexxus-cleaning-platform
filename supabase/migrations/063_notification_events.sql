-- Notification outbox.
--
-- Today only realtime/in-app reads from this table. Tomorrow an SMS dispatcher
-- and an email dispatcher read the same rows, marking `sms_dispatched_at` /
-- `email_dispatched_at` once delivered.
--
-- API routes call recordNotificationEvent() after every appointment state
-- change. The dispatcher is the only code that touches the *_dispatched_at
-- columns — no other code path mutates these rows.

CREATE TABLE notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  in_app_dispatched_at TIMESTAMPTZ,
  sms_dispatched_at TIMESTAMPTZ,
  email_dispatched_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX idx_notification_events_pending_in_app
  ON notification_events (send_after)
  WHERE in_app_dispatched_at IS NULL;

CREATE INDEX idx_notification_events_pending_sms
  ON notification_events (send_after)
  WHERE sms_dispatched_at IS NULL;

CREATE INDEX idx_notification_events_recipient
  ON notification_events (recipient_user_id, created_at DESC);

ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_events_read_own ON notification_events
  FOR SELECT USING (recipient_user_id = auth.uid());

ALTER TABLE notification_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE notification_events;
