-- Migration: 059_appointment_requests.sql
--
-- Adds the homeowner-initiated booking request flow on top of the existing
-- appointment scheduling model. Key idea: a "request" lives in the
-- `appointments` table from day one (homeowner_initiated=true), but tracks
-- a separate lifecycle column `request_state` while we route through cleaners.
--
-- We deliberately do NOT extend the `appointment_status` enum. The lifecycle
-- column is a sidecar so existing queries / RLS / UI keep working unchanged
-- for admin direct-book appointments.
--
-- Tables added:
--   - appointment_requested_slots: 1-3 slots offered by the homeowner.
--   - appointment_routing_log: chain of cleaners asked (up to 3 attempts).
--
-- Adds manager_permissions.can_handle_requests so admins can delegate the
-- request-handling job to specific managers (separate from existing
-- approve/decline-bookings flag).

-- ── Request lifecycle ─────────────────────────────────────────────────────
CREATE TYPE "public"."appointment_request_state" AS ENUM (
    'awaiting_admin',
    'routing',
    'needs_admin_attention',
    'completed'
);

ALTER TYPE "public"."appointment_request_state" OWNER TO "postgres";

ALTER TABLE "public"."appointments"
    ADD COLUMN IF NOT EXISTS "homeowner_initiated" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "request_state" "public"."appointment_request_state";

COMMENT ON COLUMN "public"."appointments"."homeowner_initiated" IS
    'True when the appointment originated from a homeowner self-request (vs an admin direct-book). Drives the routing flow and hides counter-propose for cleaners.';

COMMENT ON COLUMN "public"."appointments"."request_state" IS
    'Sidecar to status for the routing lifecycle. NULL on admin direct-book appointments. awaiting_admin → admin assigns cleaner → routing → completed | needs_admin_attention.';

-- ── Offered slots ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."appointment_requested_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "appointment_id" "uuid" NOT NULL,
    "slot_index" smallint NOT NULL,
    "scheduled_date" "date" NOT NULL,
    "scheduled_time" time without time zone NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
    CONSTRAINT "appointment_requested_slots_slot_index_check"
        CHECK (("slot_index" >= 0 AND "slot_index" <= 2)),
    CONSTRAINT "appointment_requested_slots_appointment_id_fkey"
        FOREIGN KEY ("appointment_id")
        REFERENCES "public"."appointments"("id") ON DELETE CASCADE,
    CONSTRAINT "appointment_requested_slots_appt_idx_unique"
        UNIQUE ("appointment_id", "slot_index")
);

ALTER TABLE ONLY "public"."appointment_requested_slots" REPLICA IDENTITY FULL;
ALTER TABLE "public"."appointment_requested_slots" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "appointment_requested_slots_appt_idx"
    ON "public"."appointment_requested_slots" ("appointment_id");

-- ── Routing log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."appointment_routing_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "appointment_id" "uuid" NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "attempt_index" smallint NOT NULL,
    "sent_at" timestamp with time zone NOT NULL DEFAULT "now"(),
    "deadline_at" timestamp with time zone NOT NULL,
    "response" text NOT NULL DEFAULT 'pending',
    "responded_at" timestamp with time zone,
    "decline_reason" text,
    "slot_index_chosen" smallint,
    "created_at" timestamp with time zone NOT NULL DEFAULT "now"(),
    CONSTRAINT "appointment_routing_log_response_check"
        CHECK ("response" IN ('pending', 'accepted', 'declined', 'expired')),
    CONSTRAINT "appointment_routing_log_attempt_index_check"
        CHECK ("attempt_index" >= 1 AND "attempt_index" <= 3),
    CONSTRAINT "appointment_routing_log_appointment_id_fkey"
        FOREIGN KEY ("appointment_id")
        REFERENCES "public"."appointments"("id") ON DELETE CASCADE,
    CONSTRAINT "appointment_routing_log_attempt_unique"
        UNIQUE ("appointment_id", "attempt_index")
);

ALTER TABLE ONLY "public"."appointment_routing_log" REPLICA IDENTITY FULL;
ALTER TABLE "public"."appointment_routing_log" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "appointment_routing_log_appt_idx"
    ON "public"."appointment_routing_log" ("appointment_id");

-- Pending rows whose deadline has passed are candidates for auto-defer.
CREATE INDEX IF NOT EXISTS "appointment_routing_log_pending_idx"
    ON "public"."appointment_routing_log" ("deadline_at")
    WHERE "response" = 'pending';

-- ── Manager permission flag ───────────────────────────────────────────────
ALTER TABLE "public"."manager_permissions"
    ADD COLUMN IF NOT EXISTS "can_handle_requests" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."manager_permissions"."can_handle_requests" IS
    'Whether this manager can route homeowner-initiated booking requests (open Awaiting Requests, assign cleaners, escalate).';

-- ── RLS on new tables ────────────────────────────────────────────────────
-- Writes always go through service-role API routes. SELECT mirrors the parent
-- appointment visibility:
--   - homeowner of the parent appointment, OR
--   - currently-assigned cleaner_id on the parent appointment, OR
--   - admin/manager in the parent appointment's organization
ALTER TABLE "public"."appointment_requested_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."appointment_routing_log"     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view requested slots if can see parent appointment"
    ON "public"."appointment_requested_slots" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "public"."appointments" a
            WHERE a.id = "appointment_requested_slots"."appointment_id"
              AND (
                  a.homeowner_id = "auth"."uid"()
                  OR a.cleaner_id = "auth"."uid"()
                  OR (a.organization_id IS NOT NULL
                      AND "public"."is_admin_or_manager_in_org"(a.organization_id))
              )
        )
    );

CREATE POLICY "view routing log if can see parent appointment"
    ON "public"."appointment_routing_log" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "public"."appointments" a
            WHERE a.id = "appointment_routing_log"."appointment_id"
              AND (
                  a.homeowner_id = "auth"."uid"()
                  OR a.cleaner_id = "auth"."uid"()
                  OR "appointment_routing_log"."cleaner_id" = "auth"."uid"()
                  OR (a.organization_id IS NOT NULL
                      AND "public"."is_admin_or_manager_in_org"(a.organization_id))
              )
        )
    );

-- ── Realtime publication ──────────────────────────────────────────────────
-- See migrations-archive/048_invites_realtime.sql for the rationale. Wrap the
-- ADD calls in DO blocks so re-applying the migration on a database that
-- already has the table in the publication is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'appointment_requested_slots'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_requested_slots';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'appointment_routing_log'
    ) THEN
        EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_routing_log';
    END IF;
END$$;
