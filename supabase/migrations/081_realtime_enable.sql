-- Realtime enablement for the remaining user-facing / live tables.
--
-- A table streams postgres_changes only when it is BOTH in the supabase_realtime
-- publication AND has REPLICA IDENTITY FULL (so UPDATE/DELETE payloads carry the
-- previous row). The original core tables were added to the publication via the
-- Supabase dashboard historically; this migration is the durable, reproducible
-- path for the rest. Same guarded pattern as migrations 059 / 063 / 065.
--
-- Consumers wired in this change:
--   payouts                      -> useAdminPayouts, useCleanerStripeSummary (status flips)
--   invoices                     -> useAdminInvoices (draft->sent->paid)
--   job_photos                   -> useCleanerPhotos (uploads appear live)
--   checklist_line_items         -> useChecklists (cross-tab service edits)
--   refunds / disputes           -> useAdminPayments (settlement refreshes the list)
--   connect_account_drift_events -> useTenantConnect (drift banner appears live)
-- Publication-only (no dedicated consumer yet, future-proofed / covered transitively):
--   recurring_appointment_series, cleaner_suggested_times, cleaner_suggested_windows

-- 1. REPLICA IDENTITY FULL (ALTER is a no-op if the table is already FULL)
ALTER TABLE public.payouts                      REPLICA IDENTITY FULL;
ALTER TABLE public.invoices                     REPLICA IDENTITY FULL;
ALTER TABLE public.job_photos                   REPLICA IDENTITY FULL;
ALTER TABLE public.checklist_line_items         REPLICA IDENTITY FULL;
ALTER TABLE public.refunds                      REPLICA IDENTITY FULL;
ALTER TABLE public.disputes                     REPLICA IDENTITY FULL;
ALTER TABLE public.recurring_appointment_series REPLICA IDENTITY FULL;
ALTER TABLE public.connect_account_drift_events REPLICA IDENTITY FULL;
ALTER TABLE public.cleaner_suggested_times      REPLICA IDENTITY FULL;
ALTER TABLE public.cleaner_suggested_windows    REPLICA IDENTITY FULL;

-- 2. Add to the supabase_realtime publication (guarded so re-running is safe)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payouts',
    'invoices',
    'job_photos',
    'checklist_line_items',
    'refunds',
    'disputes',
    'recurring_appointment_series',
    'connect_account_drift_events',
    'cleaner_suggested_times',
    'cleaner_suggested_windows'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
