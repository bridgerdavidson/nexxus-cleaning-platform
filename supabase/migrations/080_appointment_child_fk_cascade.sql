-- 080_appointment_child_fk_cascade.sql
--
-- Make payment_events and refunds cascade on appointment delete, consistent
-- with payments, payouts, and job_photos which already use ON DELETE CASCADE.
-- This lets a property delete fully cascade:
--   properties → appointments → payment_events / refunds / payments / payouts / job_photos
-- Without this, a delete of a property whose appointments have payment_event or
-- refund rows fails with a foreign-key violation ("Failed to delete property").

BEGIN;

-- payment_events.appointment_id (nullable)
ALTER TABLE public.payment_events
  DROP CONSTRAINT IF EXISTS payment_events_appointment_id_fkey;

ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_appointment_id_fkey
    FOREIGN KEY (appointment_id)
    REFERENCES public.appointments(id)
    ON DELETE CASCADE;

-- refunds.appointment_id (NOT NULL)
ALTER TABLE public.refunds
  DROP CONSTRAINT IF EXISTS refunds_appointment_id_fkey;

ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_appointment_id_fkey
    FOREIGN KEY (appointment_id)
    REFERENCES public.appointments(id)
    ON DELETE CASCADE;

COMMIT;
