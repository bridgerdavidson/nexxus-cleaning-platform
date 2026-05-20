-- 060_appointment_slots_admin_write.sql
--
-- The admin direct-book flow (AddAppointmentModal) inserts rows into
-- appointment_requested_slots via the client Supabase, but migration 059
-- only created a SELECT policy. Admin/manager INSERTs were silently
-- rejected by RLS (42501), so the cleaner only ever saw the primary
-- time on admin-created appointments.
--
-- Add a parallel "manage" policy so admins/managers can INSERT/UPDATE/
-- DELETE slot rows for appointments in their own organization.
-- Cleaners and homeowners stay read-only (the existing 059 SELECT policy
-- already lets them see their own slots).

CREATE POLICY "admins manage requested slots in their org"
    ON "public"."appointment_requested_slots" FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM "public"."appointments" a
            WHERE a.id = "appointment_requested_slots"."appointment_id"
              AND a.organization_id IS NOT NULL
              AND "public"."is_admin_or_manager_in_org"(a.organization_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM "public"."appointments" a
            WHERE a.id = "appointment_requested_slots"."appointment_id"
              AND a.organization_id IS NOT NULL
              AND "public"."is_admin_or_manager_in_org"(a.organization_id)
        )
    );
