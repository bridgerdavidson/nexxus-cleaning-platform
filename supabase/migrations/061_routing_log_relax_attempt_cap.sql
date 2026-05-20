-- 061_routing_log_relax_attempt_cap.sql
--
-- Migration 059 added a CHECK constraint capping attempt_index at 3, matching
-- the auto-defer chain depth. But this also blocks the admin force-assign
-- path: when the auto-defer chain exhausts and request_state flips to
-- `needs_admin_attention`, admins use assign-cleaner to manually retry. With
-- the hard cap, the next routing_log INSERT fails on the constraint and the
-- request is stuck.
--
-- Relax the cap so admins can keep appending attempts past 3. The soft cap
-- of 3 still applies in the auto-defer chain (enforced in code), so this only
-- opens the door for manual admin force-assigns.

ALTER TABLE "public"."appointment_routing_log"
    DROP CONSTRAINT IF EXISTS "appointment_routing_log_attempt_index_check";

ALTER TABLE "public"."appointment_routing_log"
    ADD CONSTRAINT "appointment_routing_log_attempt_index_check"
        CHECK ("attempt_index" >= 1);
