-- T1-10: dead-letter terminalization for webhook_events.
--
-- The dead-letter retry sweep (retryDeadLetterWebhooks) re-dispatches every non-'processed' row
-- oldest-first. A permanently-unrecoverable event (e.g. one on a detached Connect account, or a
-- deleted event) fails every sweep and, being among the oldest, occupies a slot in the ascending
-- FIFO batch forever, starving newer recoverable dead-letters. Add:
--   1. retry_count  — how many times the sweep has retried the row (advanced only by the serialized
--                     sweep, so a plain write is race-free).
--   2. a terminal 'dead' status — set after DEAD_LETTER_MAX_ATTEMPTS failures; excluded from the
--      sweep's retry selection so the batch drains. A row going 'dead' raises a critical platform
--      alert (a dead Connect event is money state we could not process).

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

-- Extend the status CHECK to allow 'dead'.
ALTER TABLE public.webhook_events DROP CONSTRAINT IF EXISTS webhook_events_status_chk;
ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_status_chk
  CHECK (status IN ('received', 'processed', 'failed', 'dead'));

-- The sweep now selects status IN ('received','failed'); keep the partial index aligned so 'dead'
-- (and 'processed') rows stay out of it and the retry selection stays cheap as dead rows accumulate.
DROP INDEX IF EXISTS public.webhook_events_status_idx;
CREATE INDEX IF NOT EXISTS webhook_events_status_idx
  ON public.webhook_events (status)
  WHERE status IN ('received', 'failed');
