-- Adds a server-side function to batch-update payout percentages for multiple
-- cleaners in a single DB round-trip instead of N sequential calls.
-- SECURITY INVOKER means the existing RLS policies on cleaner_profiles
-- still apply, so only rows the caller is allowed to update will change.

CREATE OR REPLACE FUNCTION public.bulk_update_cleaner_payouts(
  updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE public.cleaner_profiles AS cp
  SET payout_percent = (u->>'payout_percent')::numeric
  FROM jsonb_array_elements(updates) AS u
  WHERE cp.id = (u->>'cleaner_id')::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_update_cleaner_payouts(jsonb) TO authenticated;
