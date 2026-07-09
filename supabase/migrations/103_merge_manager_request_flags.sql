-- 103_merge_manager_request_flags.sql
--
-- Collapse the two overlapping request permissions into one. Historically
-- can_handle_requests and can_approve_decline_bookings both merely unlocked
-- assign/reassign; keeping both was a UX and enforcement trap. OR the two on
-- every existing row, then drop the redundant column. can_approve_decline_bookings
-- is referenced by NO RLS policy (only app/route code), so dropping it is safe.

UPDATE public.manager_permissions
SET can_handle_requests = can_handle_requests OR can_approve_decline_bookings
WHERE can_approve_decline_bookings = true
  AND can_handle_requests = false;

ALTER TABLE public.manager_permissions
  DROP COLUMN IF EXISTS can_approve_decline_bookings;
