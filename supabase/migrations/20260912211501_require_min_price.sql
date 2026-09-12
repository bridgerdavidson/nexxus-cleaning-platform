-- require_min_price: every job price and every service base price must be at least $1.00.
--
-- Why: a $0 job is broken in every payment mode. A customer-billed charge falls below
-- Stripe's 50 cent minimum and fails, a company-pays percentage cleaner earns $0, and the
-- platform fee (a percentage of the job price) is $0. A pilot org booked exactly that on a
-- "Custom" service left at $0.
--
-- The app enforces the rule in the booking and service forms and in the API routes
-- (src/lib/pricing/minJobPrice.ts owns the number and the copy). This migration is the
-- backstop: the operator booking form and the services screen write straight from the
-- browser through the RLS client, so a stale open tab could skip the UI checks.
--
-- BEFORE triggers, NOT CHECK constraints. Production has one service_types row and one
-- appointments row at $0 today. A CHECK (even NOT VALID) is re-evaluated on EVERY update
-- of the row, so it would reject an unrelated column update (a status change, a notes
-- edit) on those legacy rows. The triggers below only look at the price when the price is
-- being written, and only raise when it is new (INSERT) or actually changed.
--
-- Charge basis: every money path (chargeCompletedAppointment, chargeAchAppointment,
-- chargeSelfPayAchAppointment, settleSelfPay, settleCleanerPayout, createPayRequest,
-- reconcile) reads appointments.total_price. price_override_total is display/edit state;
-- writers copy the override into total_price. So total_price is the column guarded. The
-- override columns are deliberately NOT checked: legacy rows carry the inert pair
-- (price_override_enabled = true, price_override_total = null), and gating on them would
-- break edits to those rows without protecting any charge.
--
-- Checklist interaction: recalculate_totals_for_checklist (fired by
-- trigger_checklist_price_adder_recalc when a checklist's price_adder changes) rewrites
-- total_price = base_price + price_adder on every non-override appointment and series row
-- that uses the checklist. Because the guard ignores an UPDATE whose total_price IS NOT
-- DISTINCT FROM the old value, such an edit keeps working for existing $0-service rows
-- whenever the recomputed total does not change. It raises only when the edit would
-- actually re-price a row to under $1, which is the case the rule exists to block.
--
-- Errors use SQLSTATE 23514 (check_violation) with the same user-facing message as the
-- app helper, so a client surfaces it as-is.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS before CREATE TRIGGER.

-- appointments.total_price and recurring_appointment_series.total_price share the column
-- name and the rule, so one function serves both tables.
CREATE OR REPLACE FUNCTION public.enforce_min_total_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.total_price IS NOT DISTINCT FROM OLD.total_price THEN
    RETURN NEW;
  END IF;
  IF NEW.total_price IS NULL OR NEW.total_price < 1 THEN
    RAISE EXCEPTION 'Price must be at least $1.'
      USING ERRCODE = '23514',
            DETAIL = format('%s.total_price %s is below the $1.00 minimum.', TG_TABLE_NAME, NEW.total_price);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_min_total_price() IS
  'BEFORE INSERT/UPDATE OF total_price guard: a new or changed total_price must be >= 1.00. Unchanged legacy values pass. See migration require_min_price.';

CREATE OR REPLACE FUNCTION public.enforce_min_service_base_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.base_price IS NOT DISTINCT FROM OLD.base_price THEN
    RETURN NEW;
  END IF;
  IF NEW.base_price IS NULL OR NEW.base_price < 1 THEN
    RAISE EXCEPTION 'Price must be at least $1.'
      USING ERRCODE = '23514',
            DETAIL = format('service_types.base_price %s is below the $1.00 minimum.', NEW.base_price);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_min_service_base_price() IS
  'BEFORE INSERT/UPDATE OF base_price guard: a new or changed base_price must be >= 1.00. Unchanged legacy values pass. See migration require_min_price.';

DROP TRIGGER IF EXISTS appointments_min_total_price ON public.appointments;
CREATE TRIGGER appointments_min_total_price
  BEFORE INSERT OR UPDATE OF total_price ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_min_total_price();

DROP TRIGGER IF EXISTS recurring_appointment_series_min_total_price ON public.recurring_appointment_series;
CREATE TRIGGER recurring_appointment_series_min_total_price
  BEFORE INSERT OR UPDATE OF total_price ON public.recurring_appointment_series
  FOR EACH ROW EXECUTE FUNCTION public.enforce_min_total_price();

DROP TRIGGER IF EXISTS service_types_min_base_price ON public.service_types;
CREATE TRIGGER service_types_min_base_price
  BEFORE INSERT OR UPDATE OF base_price ON public.service_types
  FOR EACH ROW EXECUTE FUNCTION public.enforce_min_service_base_price();
