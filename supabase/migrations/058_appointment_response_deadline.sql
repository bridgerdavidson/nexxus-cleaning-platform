-- Wave 2: tiered SLA on cleaner response.
--
-- Adds appointments.response_deadline (timestamptz). Set by the appointment
-- create endpoint and any reassign-cleaner path; cleared/ignored once the
-- cleaner has responded. "Overdue" is derived on read:
--
--   response_deadline < now() AND cleaner_confirmation_status = 'awaiting'
--
-- No cron / scheduled job. Admin escalation surfaces are driven entirely by
-- this derived predicate on the client.

ALTER TABLE "public"."appointments"
    ADD COLUMN IF NOT EXISTS "response_deadline" timestamp with time zone;

COMMENT ON COLUMN "public"."appointments"."response_deadline" IS
    'Tiered SLA for cleaner acceptance. Set on appointment create and reassign: 4h when the job is <48h away (urgent), 24h otherwise. NULL once the cleaner has responded (approved/rejected). Overdue state is derived on read.';

CREATE INDEX IF NOT EXISTS "appointments_overdue_idx"
    ON "public"."appointments" ("organization_id", "response_deadline")
    WHERE "cleaner_confirmation_status" = 'awaiting';

-- Backfill existing pending rows with a generous default so nothing flips
-- overdue immediately on deploy. Only touches rows where the cleaner hasn't
-- responded yet — already-approved or rejected rows stay NULL.
UPDATE "public"."appointments"
SET "response_deadline" = "now"() + INTERVAL '24 hours'
WHERE "response_deadline" IS NULL
    AND "cleaner_confirmation_status" = 'awaiting'
    AND "status" IN ('pending', 'confirmed');
