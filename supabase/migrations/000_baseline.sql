

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."appointment_status" AS ENUM (
    'pending',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."appointment_status" OWNER TO "postgres";


CREATE TYPE "public"."cleaner_confirmation_status" AS ENUM (
    'awaiting',
    'approved',
    'rejected'
);


ALTER TYPE "public"."cleaner_confirmation_status" OWNER TO "postgres";


CREATE TYPE "public"."inv_status" AS ENUM (
    'pending',
    'accepted',
    'revoked',
    'expired',
    'creating',
    'superseded',
    'failed'
);


ALTER TYPE "public"."inv_status" OWNER TO "postgres";


CREATE TYPE "public"."invoice_status" AS ENUM (
    'draft',
    'sent',
    'paid',
    'cancelled'
);


ALTER TYPE "public"."invoice_status" OWNER TO "postgres";


CREATE TYPE "public"."job_progress" AS ENUM (
    'not_started',
    'before_photos',
    'checklist',
    'after_photos',
    'completed'
);


ALTER TYPE "public"."job_progress" OWNER TO "postgres";


CREATE TYPE "public"."org_role" AS ENUM (
    'owner',
    'admin',
    'manager',
    'cleaner',
    'homeowner'
);


ALTER TYPE "public"."org_role" OWNER TO "postgres";


CREATE TYPE "public"."payment_method" AS ENUM (
    'card',
    'ach',
    'manual'
);


ALTER TYPE "public"."payment_method" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_type" AS ENUM (
    'revenue',
    'expense',
    'refund'
);


ALTER TYPE "public"."payment_type" OWNER TO "postgres";


CREATE TYPE "public"."payout_status" AS ENUM (
    'pending',
    'approved',
    'paid',
    'failed',
    'bank_paid',
    'reversed'
);


ALTER TYPE "public"."payout_status" OWNER TO "postgres";


CREATE TYPE "public"."service_type" AS ENUM (
    'regular',
    'deep',
    'move_out',
    'custom'
);


ALTER TYPE "public"."service_type" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'homeowner',
    'cleaner',
    'admin',
    'manager'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_dashboard_stats"("p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_total_bookings bigint;
  v_active_cleaners bigint;
  v_pending_approvals bigint;
  v_completed_jobs bigint;
  v_total_revenue numeric;
  v_avg_rating numeric;
  v_recent_jobs bigint;
begin
  select count(*) into v_total_bookings
    from appointments where organization_id = p_org_id;

  select count(*) into v_active_cleaners
    from cleaner_profiles where organization_id = p_org_id and is_available = true;

  select count(*) into v_pending_approvals
    from appointments where organization_id = p_org_id and status = 'pending';

  select count(*) into v_completed_jobs
    from appointments where organization_id = p_org_id and status = 'completed';

  select coalesce(sum(amount), 0) into v_total_revenue
    from payments where organization_id = p_org_id and status = 'paid';

  select coalesce(avg(rating), 0) into v_avg_rating
    from reviews where organization_id = p_org_id;

  select count(*) into v_recent_jobs
    from appointments
    where organization_id = p_org_id
      and created_at >= (now() - interval '30 days');

  return jsonb_build_object(
    'totalBookings', v_total_bookings,
    'activeCleaners', v_active_cleaners,
    'pendingApprovals', v_pending_approvals,
    'completedJobs', v_completed_jobs,
    'totalRevenue', v_total_revenue,
    'avgRating', round(v_avg_rating::numeric, 1),
    'recentJobs', v_recent_jobs,
    'completionRate', case
      when v_total_bookings = 0 then 0
      else round((v_completed_jobs::numeric / v_total_bookings) * 100, 1)
    end,
    'avgJobsPerDay', round(v_recent_jobs::numeric / 30, 1),
    'avgJobValue', case
      when v_total_bookings = 0 then 0
      else round(v_total_revenue / v_total_bookings)
    end
  );
end;
$$;


ALTER FUNCTION "public"."admin_dashboard_stats"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_update_cleaner_payouts"("updates" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.cleaner_profiles AS cp
  SET payout_percent = (u->>'payout_percent')::numeric
  FROM jsonb_array_elements(updates) AS u
  WHERE cp.id = (u->>'cleaner_id')::uuid;
END;
$$;


ALTER FUNCTION "public"."bulk_update_cleaner_payouts"("updates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_admin_update_cleaner_profile"("admin_user_id" "uuid", "cleaner_profile_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Check if admin/manager and cleaner are in the same organization
    -- This query runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om_admin
        INNER JOIN public.organization_members om_cleaner
            ON om_admin.organization_id = om_cleaner.organization_id
        WHERE om_admin.user_id = admin_user_id
        AND om_admin.role IN ('owner', 'admin', 'manager')
        AND om_cleaner.user_id = cleaner_profile_id
        AND om_cleaner.role = 'cleaner'
    );
END;
$$;


ALTER FUNCTION "public"."can_admin_update_cleaner_profile"("admin_user_id" "uuid", "cleaner_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_admin_update_user_profile"("admin_user_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Check if admin_user_id is an admin/manager and target_user_id is in the same organization
    -- This query runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om_admin
        INNER JOIN public.organization_members om_target
            ON om_admin.organization_id = om_target.organization_id
        WHERE om_admin.user_id = admin_user_id
        AND om_admin.role IN ('owner', 'admin', 'manager')
        AND om_target.user_id = target_user_id
    );
END;
$$;


ALTER FUNCTION "public"."can_admin_update_user_profile"("admin_user_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_admin_view_appointment"("admin_user_id" "uuid", "appointment_homeowner_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Check if admin/manager and homeowner are in the same organization
    -- This query runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om_admin
        INNER JOIN public.organization_members om_homeowner
            ON om_admin.organization_id = om_homeowner.organization_id
        WHERE om_admin.user_id = admin_user_id
        AND om_admin.role IN ('owner', 'admin', 'manager')
        AND om_homeowner.user_id = appointment_homeowner_id
    );
END;
$$;


ALTER FUNCTION "public"."can_admin_view_appointment"("admin_user_id" "uuid", "appointment_homeowner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_message_role"("viewer_role" "public"."user_role", "target_role" "public"."user_role") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case viewer_role
    when 'admin'     then true
    when 'manager'   then true
    when 'cleaner'   then target_role in ('admin','manager')
    when 'homeowner' then target_role in ('admin','manager')
  end;
$$;


ALTER FUNCTION "public"."can_message_role"("viewer_role" "public"."user_role", "target_role" "public"."user_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_message_user"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  viewer_role user_role;
  target_role user_role;
begin
  if auth.uid() is null then
    return false;
  end if;

  select role into viewer_role from user_profiles where id = auth.uid();
  select role into target_role from user_profiles where id = target_user_id;

  if viewer_role is null or target_role is null then
    return false;
  end if;

  return public.can_message_role(viewer_role, target_role);
end;
$$;


ALTER FUNCTION "public"."can_message_user"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleaner_stats"("p_cleaner_id" "uuid", "p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_payout_percent numeric;
  v_total_jobs bigint;
  v_completed_jobs bigint;
  v_upcoming_jobs bigint;
  v_completed_this_week bigint;
  v_total_earnings_gross numeric;
  v_paid_amount numeric;
  v_cleaner_earnings numeric;
begin
  select coalesce(payout_percent, 0) into v_payout_percent
    from cleaner_profiles
    where id = p_cleaner_id and organization_id = p_org_id;

  if not found then
    raise exception 'cleaner profile not found' using errcode = 'PGRST116';
  end if;

  select count(*) into v_total_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id;

  select count(*) into v_completed_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id and status = 'completed';

  select count(*) into v_upcoming_jobs
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id
      and status in ('pending', 'confirmed', 'in_progress');

  select count(*) into v_completed_this_week
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id
      and status = 'completed'
      and scheduled_date >= (current_date - interval '7 days');

  select coalesce(sum(total_price), 0) into v_total_earnings_gross
    from appointments
    where cleaner_id = p_cleaner_id and organization_id = p_org_id and status = 'completed';

  v_cleaner_earnings := v_total_earnings_gross * (v_payout_percent / 100.0);

  select coalesce(sum(p.amount), 0) into v_paid_amount
    from payments p
    join appointments a on a.id = p.appointment_id
    where a.cleaner_id = p_cleaner_id
      and a.organization_id = p_org_id
      and a.status = 'completed'
      and p.status = 'paid';

  return jsonb_build_object(
    'totalJobs', v_total_jobs,
    'completedJobs', v_completed_jobs,
    'upcomingJobs', v_upcoming_jobs,
    'completedThisWeek', v_completed_this_week,
    'totalEarnings', round(v_cleaner_earnings),
    'pendingPayouts', round(greatest(0, v_cleaner_earnings - v_paid_amount))
  );
end;
$$;


ALTER FUNCTION "public"."cleaner_stats"("p_cleaner_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_checklist_for_service"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  new_checklist_id UUID;
BEGIN
  -- Create default checklist for the new service type
  INSERT INTO checklists (name, service_type_id)
  VALUES ('Default Checklist', NEW.id)
  RETURNING id INTO new_checklist_id;
  
  -- Insert starter items in order
  INSERT INTO checklist_line_items (task, checklist_id) VALUES
    ('Put on gloves and prepare cleaning supplies', new_checklist_id),
    ('Pick up and dispose of trash', new_checklist_id),
    ('Tidy visible clutter (do not organize personal items)', new_checklist_id),
    ('Dust all reachable surfaces (top to bottom)', new_checklist_id),
    ('Wipe light switches and door handles', new_checklist_id),
    ('Spot clean walls and doors (as needed)', new_checklist_id),
    ('Vacuum carpets and rugs', new_checklist_id),
    ('Sweep and mop hard floors', new_checklist_id),
    ('Final visual check of room', new_checklist_id);
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_default_checklist_for_service"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_conversation"("user1_id" "uuid", "user2_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  conversation_id uuid;
  p1_id uuid;
  p2_id uuid;
begin
  if not public.can_message_user(user2_id) then
    raise exception 'forbidden: messaging not permitted between these roles'
      using errcode = '42501';
  end if;

  if user1_id < user2_id then
    p1_id := user1_id;
    p2_id := user2_id;
  else
    p1_id := user2_id;
    p2_id := user1_id;
  end if;

  select id into conversation_id
  from conversations
  where participant_1_id = p1_id and participant_2_id = p2_id;

  if conversation_id is null then
    insert into conversations (participant_1_id, participant_2_id)
    values (p1_id, p2_id)
    returning id into conversation_id;
  end if;

  return conversation_id;
end;
$$;


ALTER FUNCTION "public"."get_or_create_conversation"("user1_id" "uuid", "user2_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_organization_ids"("check_user_id" "uuid") RETURNS "uuid"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  org_ids uuid[];
begin
  select array_agg(organization_id) into org_ids
  from public.organization_members
  where user_id = check_user_id;
  return coalesce(org_ids, array[]::uuid[]);
end;
$$;


ALTER FUNCTION "public"."get_user_organization_ids"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_checklist_price_adder_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.price_adder IS DISTINCT FROM OLD.price_adder THEN
    PERFORM recalculate_totals_for_checklist(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_checklist_price_adder_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_role text;
BEGIN
    -- Get role from app_metadata (NOT user_metadata)
    v_role := COALESCE(NEW.raw_app_meta_data->>'role', 'homeowner');
    
    INSERT INTO public.user_profiles (id, email, first_name, last_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        v_role::public.user_role
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        role = EXCLUDED.role,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Creates user profile on signup. Role from app_metadata (secure), names from user_metadata.';



CREATE OR REPLACE FUNCTION "public"."is_admin_or_manager_in_org"("check_org_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Check if current user is admin/manager/owner in the given organization
    -- SECURITY DEFINER means this runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.user_id = auth.uid()
        AND om.organization_id = check_org_id
        AND om.role IN ('owner', 'admin', 'manager')
    );
END;
$$;


ALTER FUNCTION "public"."is_admin_or_manager_in_org"("check_org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin_or_manager_in_org"("check_org_id" "uuid") IS 'SECURITY DEFINER function that checks if the current user is an admin/manager/owner in the given organization. Bypasses RLS by running with postgres privileges.';



CREATE OR REPLACE FUNCTION "public"."org_customers_with_counts"("p_org_id" "uuid") RETURNS TABLE("id" "uuid", "first_name" "text", "last_name" "text", "email" "text", "phone" "text", "avatar_url" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "properties_count" bigint, "appointments_count" bigint, "total_spent" numeric, "last_appointment_date" "date")
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  with homeowners as (
    select om.user_id
    from organization_members om
    where om.organization_id = p_org_id
      and om.role = 'homeowner'
  )
  select
    up.id,
    up.first_name,
    up.last_name,
    up.email,
    up.phone,
    up.avatar_url,
    up.created_at,
    up.updated_at,
    coalesce(p.cnt, 0) as properties_count,
    coalesce(a.cnt, 0) as appointments_count,
    coalesce(a.total_spent, 0) as total_spent,
    a.last_date as last_appointment_date
  from homeowners h
  join user_profiles up on up.id = h.user_id
  left join (
    select owner_id, count(*) as cnt
    from properties
    where organization_id = p_org_id
    group by owner_id
  ) p on p.owner_id = up.id
  left join (
    select
      homeowner_id,
      count(*) as cnt,
      sum(total_price) as total_spent,
      max(scheduled_date) as last_date
    from appointments
    where organization_id = p_org_id
    group by homeowner_id
  ) a on a.homeowner_id = up.id
  order by up.created_at desc;
$$;


ALTER FUNCTION "public"."org_customers_with_counts"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payment_stats"("p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_total_revenue numeric;
  v_pending_payouts numeric;
  v_this_month_revenue numeric;
  v_first_of_month timestamptz := date_trunc('month', now());
begin
  select coalesce(sum(amount), 0) into v_total_revenue
    from payments
    where organization_id = p_org_id
      and status = 'paid'
      and payment_type = 'revenue';

  select coalesce(sum(amount), 0) into v_pending_payouts
    from payouts
    where organization_id = p_org_id and status = 'pending';

  select coalesce(sum(amount), 0) into v_this_month_revenue
    from payments
    where organization_id = p_org_id
      and status = 'paid'
      and payment_type = 'revenue'
      and created_at >= v_first_of_month;

  return jsonb_build_object(
    'totalRevenue', round(v_total_revenue),
    'pendingPayouts', round(v_pending_payouts),
    'thisMonthRevenue', round(v_this_month_revenue)
  );
end;
$$;


ALTER FUNCTION "public"."payment_stats"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_totals_for_checklist"("p_checklist_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE appointments a
  SET total_price = st.base_price + c.price_adder
  FROM service_types st, checklists c
  WHERE a.service_type_id = st.id
    AND c.id = a.checklist_id
    AND c.id = p_checklist_id
    AND COALESCE(a.price_override_enabled, FALSE) = FALSE;

  UPDATE recurring_appointment_series ras
  SET total_price = st.base_price + c.price_adder
  FROM service_types st, checklists c
  WHERE ras.service_type_id = st.id
    AND c.id = ras.checklist_id
    AND c.id = p_checklist_id
    AND COALESCE(ras.price_override_enabled, FALSE) = FALSE;
END;
$$;


ALTER FUNCTION "public"."recalculate_totals_for_checklist"("p_checklist_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_checklists_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_checklists_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_conversation_last_message"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE conversations
    SET last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_conversation_last_message"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_manager_permissions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_manager_permissions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_service_types_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_service_types_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_shares_org_with_homeowner"("check_homeowner_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Check if current user (admin/manager) shares organization with homeowner
    -- SECURITY DEFINER means this runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om_admin
        INNER JOIN public.organization_members om_homeowner
            ON om_admin.organization_id = om_homeowner.organization_id
        WHERE om_admin.user_id = auth.uid()
        AND om_admin.role IN ('owner', 'admin', 'manager')
        AND om_homeowner.user_id = check_homeowner_id
    );
END;
$$;


ALTER FUNCTION "public"."user_shares_org_with_homeowner"("check_homeowner_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_shares_org_with_homeowner"("check_homeowner_id" "uuid") IS 'SECURITY DEFINER function that checks if the current admin/manager user shares an organization with the given homeowner. Bypasses RLS by running with postgres privileges.';



CREATE OR REPLACE FUNCTION "public"."users_share_organization"("user1_id" "uuid", "user2_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Check if both users are in at least one common organization
    -- This query runs with postgres privileges and bypasses RLS
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members om1
        INNER JOIN public.organization_members om2 
            ON om1.organization_id = om2.organization_id
        WHERE om1.user_id = user1_id
        AND om2.user_id = user2_id
    );
END;
$$;


ALTER FUNCTION "public"."users_share_organization"("user1_id" "uuid", "user2_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "homeowner_id" "uuid" NOT NULL,
    "cleaner_id" "uuid",
    "property_id" "uuid" NOT NULL,
    "service_type_id" "uuid" NOT NULL,
    "scheduled_date" "date" NOT NULL,
    "scheduled_time" time without time zone NOT NULL,
    "duration_minutes" integer NOT NULL,
    "status" "public"."appointment_status" DEFAULT 'pending'::"public"."appointment_status",
    "total_price" numeric(10,2) NOT NULL,
    "special_requests" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid" NOT NULL,
    "series_id" "uuid",
    "cleaner_confirmation_status" "public"."cleaner_confirmation_status" DEFAULT 'awaiting'::"public"."cleaner_confirmation_status",
    "job_progress" "public"."job_progress" DEFAULT 'not_started'::"public"."job_progress",
    "checklist_id" "uuid",
    "price_override_enabled" boolean DEFAULT false NOT NULL,
    "price_override_total" numeric(10,2)
);

ALTER TABLE ONLY "public"."appointments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."appointments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."appointments"."cleaner_confirmation_status" IS 'Cleaner availability confirmation status: awaiting (pending cleaner response), approved (cleaner confirmed), rejected (cleaner declined - needs rescheduling). Defaults to awaiting for new appointments.';



COMMENT ON COLUMN "public"."appointments"."job_progress" IS 'Tracks cleaner workflow progress: not_started -> before_photos -> checklist -> after_photos -> completed';



CREATE TABLE IF NOT EXISTS "public"."checklist_line_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "task" "text" NOT NULL,
    "checklist_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "position" integer
);


ALTER TABLE "public"."checklist_line_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."checklist_line_items"."position" IS 'Sort order within the checklist (0-indexed). NULL values sort last, then by created_at.';



CREATE TABLE IF NOT EXISTS "public"."checklists" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" DEFAULT 'Checklist'::"text" NOT NULL,
    "service_type_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "price_adder" numeric(10,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "checklists_price_adder_non_negative" CHECK (("price_adder" >= (0)::numeric))
);

ALTER TABLE ONLY "public"."checklists" REPLICA IDENTITY FULL;


ALTER TABLE "public"."checklists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_availability_feedback" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "cleaner_id" "uuid" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cleaner_availability_feedback" OWNER TO "postgres";


COMMENT ON TABLE "public"."cleaner_availability_feedback" IS 'Stores feedback from cleaners when they decline an appointment, including reason and suggested alternative times.';



CREATE TABLE IF NOT EXISTS "public"."cleaner_profiles" (
    "id" "uuid" NOT NULL,
    "bio" "text",
    "experience_years" integer,
    "hourly_rate" numeric(10,2),
    "rating" numeric(3,2) DEFAULT 0.00,
    "total_jobs" integer DEFAULT 0,
    "is_available" boolean DEFAULT true,
    "background_check_verified" boolean DEFAULT false,
    "insurance_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid" NOT NULL,
    "stripe_connect_account_id" "text",
    "stripe_connect_onboarding_complete" boolean DEFAULT false,
    "payout_percent" numeric(5,2) DEFAULT 0.00,
    CONSTRAINT "cleaner_profiles_payout_percent_range" CHECK ((("payout_percent" >= (0)::numeric) AND ("payout_percent" <= (100)::numeric)))
);

ALTER TABLE ONLY "public"."cleaner_profiles" REPLICA IDENTITY FULL;


ALTER TABLE "public"."cleaner_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cleaner_suggested_times" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "feedback_id" "uuid" NOT NULL,
    "suggested_date" "date" NOT NULL,
    "suggested_time" time without time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cleaner_suggested_times" OWNER TO "postgres";


COMMENT ON TABLE "public"."cleaner_suggested_times" IS 'Alternative time slots suggested by a cleaner when they decline an appointment.';



CREATE TABLE IF NOT EXISTS "public"."cleaner_suggested_windows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "feedback_id" "uuid" NOT NULL,
    "window_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_time_range" CHECK (("end_time" > "start_time"))
);


ALTER TABLE "public"."cleaner_suggested_windows" OWNER TO "postgres";


COMMENT ON TABLE "public"."cleaner_suggested_windows" IS 'Availability windows (time ranges) suggested by cleaners when they decline an appointment. Same-day windows only.';



COMMENT ON COLUMN "public"."cleaner_suggested_windows"."window_date" IS 'The date for this availability window';



COMMENT ON COLUMN "public"."cleaner_suggested_windows"."start_time" IS 'Start time of the availability window';



COMMENT ON COLUMN "public"."cleaner_suggested_windows"."end_time" IS 'End time of the availability window (must be after start_time)';



CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "participant_1_id" "uuid" NOT NULL,
    "participant_2_id" "uuid" NOT NULL,
    "last_message_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "different_participants" CHECK (("participant_1_id" <> "participant_2_id"))
);

ALTER TABLE ONLY "public"."conversations" REPLICA IDENTITY FULL;


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "public"."org_role" NOT NULL,
    "status" "public"."inv_status" DEFAULT 'pending'::"public"."inv_status" NOT NULL,
    "sent_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "invited_by" "uuid" NOT NULL,
    "expiration_date" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opened_at" timestamp with time zone,
    "form_closed_at" timestamp with time zone,
    CONSTRAINT "invites_accepted_requires_timestamp" CHECK ((("status" <> 'accepted'::"public"."inv_status") OR ("accepted_at" IS NOT NULL))),
    CONSTRAINT "invites_email_lowercase" CHECK (("email" = "lower"("email"))),
    CONSTRAINT "invites_email_not_blank" CHECK (("length"(TRIM(BOTH FROM "email")) > 0))
);

ALTER TABLE ONLY "public"."invites" REPLICA IDENTITY FULL;


ALTER TABLE "public"."invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "organization_id" "uuid",
    "payment_id" "uuid",
    "appointment_id" "uuid",
    "homeowner_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" "public"."invoice_status" DEFAULT 'draft'::"public"."invoice_status",
    "due_date" "date",
    "paid_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "photo_url" "text" NOT NULL,
    "photo_type" "text" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "job_photos_photo_type_check" CHECK (("photo_type" = ANY (ARRAY['before'::"text", 'after'::"text", 'during'::"text"])))
);


ALTER TABLE "public"."job_photos" OWNER TO "postgres";


COMMENT ON TABLE "public"."job_photos" IS 'Evidence photos taken by cleaners during job execution. Photos are stored in Supabase Storage at appointments/{appointmentId}/{before|after}/{uuid}.jpg';



COMMENT ON COLUMN "public"."job_photos"."photo_type" IS 'Stage of job when photo was taken: before (property condition before cleaning), after (property after cleaning), during (mid-job if needed)';



CREATE TABLE IF NOT EXISTS "public"."manager_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "manager_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "can_view_customers" boolean DEFAULT false,
    "can_edit_customers" boolean DEFAULT false,
    "can_view_bookings" boolean DEFAULT false,
    "can_edit_bookings" boolean DEFAULT false,
    "can_manage_cleaners" boolean DEFAULT false,
    "can_view_properties" boolean DEFAULT false,
    "can_edit_properties" boolean DEFAULT false,
    "can_view_analytics" boolean DEFAULT false,
    "can_view_payments" boolean DEFAULT false,
    "can_manage_payments" boolean DEFAULT false,
    "can_view_messages" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "can_view_services" boolean DEFAULT false,
    "can_manage_services" boolean DEFAULT false,
    "can_approve_decline_bookings" boolean DEFAULT false
);

ALTER TABLE ONLY "public"."manager_permissions" REPLICA IDENTITY FULL;


ALTER TABLE "public"."manager_permissions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."manager_permissions"."can_view_services" IS 'Whether the manager can view service types in the organization';



COMMENT ON COLUMN "public"."manager_permissions"."can_manage_services" IS 'Whether the manager can create, update, and delete service types in the organization';



COMMENT ON COLUMN "public"."manager_permissions"."can_approve_decline_bookings" IS 'Allows manager to approve or decline pending appointment requests';



CREATE TABLE IF NOT EXISTS "public"."message_attachments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "file_size" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."message_attachments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."message_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "subject" "text",
    "content" "text" NOT NULL,
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid" NOT NULL,
    "conversation_id" "uuid"
);

ALTER TABLE ONLY "public"."messages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."org_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."organization_members" REPLICA IDENTITY FULL;

ALTER TABLE ONLY "public"."organization_members" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);

ALTER TABLE ONLY "public"."organizations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status",
    "stripe_payment_intent_id" "text",
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid" NOT NULL,
    "payment_type" "public"."payment_type" DEFAULT 'revenue'::"public"."payment_type",
    "payment_method" "public"."payment_method" DEFAULT 'manual'::"public"."payment_method",
    "notes" "text",
    "reference" "text"
);

ALTER TABLE ONLY "public"."payments" REPLICA IDENTITY FULL;


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payouts" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "organization_id" "uuid",
    "cleaner_id" "uuid" NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" "public"."payout_status" DEFAULT 'pending'::"public"."payout_status",
    "stripe_transfer_id" "text",
    "notes" "text",
    "approved_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "payout_percent_snapshot" numeric(5,2),
    "stripe_payout_id" "text",
    "bank_paid_at" timestamp with time zone,
    "reversed_at" timestamp with time zone
);


ALTER TABLE "public"."payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."properties" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text" NOT NULL,
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip_code" "text" NOT NULL,
    "bedrooms" integer,
    "bathrooms" integer,
    "square_feet" integer,
    "special_instructions" "text",
    "access_instructions" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid" NOT NULL,
    "photo_url" "text"
);

ALTER TABLE ONLY "public"."properties" REPLICA IDENTITY FULL;


ALTER TABLE "public"."properties" OWNER TO "postgres";


COMMENT ON COLUMN "public"."properties"."photo_url" IS 'Optional primary photo URL for the property (stored in property-photos bucket)';



CREATE TABLE IF NOT EXISTS "public"."recurring_appointment_series" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "homeowner_id" "uuid" NOT NULL,
    "cleaner_id" "uuid",
    "property_id" "uuid" NOT NULL,
    "service_type_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "duration_minutes" integer NOT NULL,
    "total_price" numeric(10,2) NOT NULL,
    "special_requests" "text",
    "recurrence_type" "text" NOT NULL,
    "interval" integer DEFAULT 1 NOT NULL,
    "days_of_week" integer[],
    "end_date" "date",
    "max_occurrences" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checklist_id" "uuid",
    "price_override_enabled" boolean DEFAULT false NOT NULL,
    "price_override_total" numeric(10,2),
    CONSTRAINT "recurring_appointment_series_duration_minutes_check" CHECK (("duration_minutes" > 0)),
    CONSTRAINT "recurring_appointment_series_interval_check" CHECK (("interval" > 0)),
    CONSTRAINT "recurring_appointment_series_max_occurrences_check" CHECK ((("max_occurrences" IS NULL) OR ("max_occurrences" > 0))),
    CONSTRAINT "recurring_appointment_series_recurrence_type_check" CHECK (("recurrence_type" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'monthly'::"text"])))
);


ALTER TABLE "public"."recurring_appointment_series" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "reviewer_id" "uuid" NOT NULL,
    "reviewee_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid" NOT NULL,
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_types" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "base_price" numeric(10,2) NOT NULL,
    "duration_minutes" integer NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "organization_id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "service_type" "text" NOT NULL
);

ALTER TABLE ONLY "public"."service_types" REPLICA IDENTITY FULL;


ALTER TABLE "public"."service_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "role" "public"."user_role" DEFAULT 'homeowner'::"public"."user_role" NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."user_profiles" REPLICA IDENTITY FULL;


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_line_items"
    ADD CONSTRAINT "checklist_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklists"
    ADD CONSTRAINT "checklists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_availability_feedback"
    ADD CONSTRAINT "cleaner_availability_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_profiles"
    ADD CONSTRAINT "cleaner_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_suggested_times"
    ADD CONSTRAINT "cleaner_suggested_times_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cleaner_suggested_windows"
    ADD CONSTRAINT "cleaner_suggested_windows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_photos"
    ADD CONSTRAINT "job_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."manager_permissions"
    ADD CONSTRAINT "manager_permissions_manager_id_organization_id_key" UNIQUE ("manager_id", "organization_id");



ALTER TABLE ONLY "public"."manager_permissions"
    ADD CONSTRAINT "manager_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_attachments"
    ADD CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_user_id_key" UNIQUE ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."properties"
    ADD CONSTRAINT "properties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_appointment_series"
    ADD CONSTRAINT "recurring_appointment_series_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_types"
    ADD CONSTRAINT "service_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "unique_conversation" UNIQUE ("participant_1_id", "participant_2_id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_appointments_checklist_id" ON "public"."appointments" USING "btree" ("checklist_id");



CREATE INDEX "idx_appointments_cleaner_confirmation_status" ON "public"."appointments" USING "btree" ("cleaner_confirmation_status");



CREATE INDEX "idx_appointments_cleaner_date" ON "public"."appointments" USING "btree" ("cleaner_id", "scheduled_date");



CREATE INDEX "idx_appointments_cleaner_id" ON "public"."appointments" USING "btree" ("cleaner_id");



CREATE INDEX "idx_appointments_homeowner_id" ON "public"."appointments" USING "btree" ("homeowner_id");



CREATE INDEX "idx_appointments_job_progress" ON "public"."appointments" USING "btree" ("job_progress");



CREATE INDEX "idx_appointments_org_date" ON "public"."appointments" USING "btree" ("organization_id", "scheduled_date");



CREATE INDEX "idx_appointments_organization_id" ON "public"."appointments" USING "btree" ("organization_id");



CREATE INDEX "idx_appointments_scheduled_date" ON "public"."appointments" USING "btree" ("scheduled_date");



CREATE INDEX "idx_appointments_series_id" ON "public"."appointments" USING "btree" ("series_id");



CREATE INDEX "idx_appointments_status" ON "public"."appointments" USING "btree" ("status");



CREATE INDEX "idx_checklist_line_items_checklist_id" ON "public"."checklist_line_items" USING "btree" ("checklist_id");



CREATE INDEX "idx_checklist_line_items_position" ON "public"."checklist_line_items" USING "btree" ("checklist_id", "position");



CREATE INDEX "idx_checklists_service_type_id" ON "public"."checklists" USING "btree" ("service_type_id");



CREATE INDEX "idx_conversations_last_message" ON "public"."conversations" USING "btree" ("last_message_at" DESC);



CREATE INDEX "idx_conversations_participant_1" ON "public"."conversations" USING "btree" ("participant_1_id");



CREATE INDEX "idx_conversations_participant_2" ON "public"."conversations" USING "btree" ("participant_2_id");



CREATE INDEX "idx_feedback_appointment_id" ON "public"."cleaner_availability_feedback" USING "btree" ("appointment_id");



CREATE INDEX "idx_feedback_cleaner_id" ON "public"."cleaner_availability_feedback" USING "btree" ("cleaner_id");



CREATE INDEX "idx_invites_email" ON "public"."invites" USING "btree" ("email");



CREATE INDEX "idx_invites_invited_by" ON "public"."invites" USING "btree" ("invited_by");



CREATE UNIQUE INDEX "idx_invites_one_pending_per_org_email" ON "public"."invites" USING "btree" ("organization_id", "email") WHERE ("status" = 'pending'::"public"."inv_status");



CREATE INDEX "idx_invites_org_email_status" ON "public"."invites" USING "btree" ("organization_id", "email", "status");



CREATE INDEX "idx_invites_organization_id" ON "public"."invites" USING "btree" ("organization_id");



CREATE INDEX "idx_invites_pending_expiry_lookup" ON "public"."invites" USING "btree" ("organization_id", "status", "expiration_date") WHERE ("status" = 'pending'::"public"."inv_status");



CREATE INDEX "idx_invites_status" ON "public"."invites" USING "btree" ("status");



CREATE INDEX "idx_invoices_appointment_id" ON "public"."invoices" USING "btree" ("appointment_id");



CREATE INDEX "idx_invoices_homeowner_id" ON "public"."invoices" USING "btree" ("homeowner_id");



CREATE INDEX "idx_invoices_invoice_number" ON "public"."invoices" USING "btree" ("invoice_number");



CREATE INDEX "idx_invoices_organization_id" ON "public"."invoices" USING "btree" ("organization_id");



CREATE INDEX "idx_invoices_payment_id" ON "public"."invoices" USING "btree" ("payment_id");



CREATE INDEX "idx_invoices_status" ON "public"."invoices" USING "btree" ("status");



CREATE INDEX "idx_job_photos_appointment_id" ON "public"."job_photos" USING "btree" ("appointment_id");



CREATE INDEX "idx_job_photos_appointment_type" ON "public"."job_photos" USING "btree" ("appointment_id", "photo_type");



CREATE INDEX "idx_manager_permissions_manager_id" ON "public"."manager_permissions" USING "btree" ("manager_id");



CREATE INDEX "idx_manager_permissions_organization_id" ON "public"."manager_permissions" USING "btree" ("organization_id");



CREATE INDEX "idx_message_attachments_message_id" ON "public"."message_attachments" USING "btree" ("message_id");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_messages_conversation_id" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_messages_recipient_id" ON "public"."messages" USING "btree" ("recipient_id");



CREATE INDEX "idx_messages_sender_id" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_payments_appointment_id" ON "public"."payments" USING "btree" ("appointment_id");



CREATE INDEX "idx_payments_payment_method" ON "public"."payments" USING "btree" ("payment_method");



CREATE INDEX "idx_payments_payment_type" ON "public"."payments" USING "btree" ("payment_type");



CREATE INDEX "idx_payouts_appointment_id" ON "public"."payouts" USING "btree" ("appointment_id");



CREATE INDEX "idx_payouts_cleaner_id" ON "public"."payouts" USING "btree" ("cleaner_id");



CREATE INDEX "idx_payouts_cleaner_status" ON "public"."payouts" USING "btree" ("cleaner_id", "status");



CREATE INDEX "idx_payouts_organization_id" ON "public"."payouts" USING "btree" ("organization_id");



CREATE INDEX "idx_payouts_paid_at" ON "public"."payouts" USING "btree" ("paid_at");



CREATE INDEX "idx_payouts_status" ON "public"."payouts" USING "btree" ("status");



CREATE INDEX "idx_payouts_stripe_payout_id" ON "public"."payouts" USING "btree" ("stripe_payout_id") WHERE ("stripe_payout_id" IS NOT NULL);



CREATE INDEX "idx_payouts_stripe_transfer_id" ON "public"."payouts" USING "btree" ("stripe_transfer_id") WHERE ("stripe_transfer_id" IS NOT NULL);



CREATE INDEX "idx_properties_owner_id" ON "public"."properties" USING "btree" ("owner_id");



CREATE INDEX "idx_recurring_series_checklist_id" ON "public"."recurring_appointment_series" USING "btree" ("checklist_id");



CREATE INDEX "idx_recurring_series_cleaner_id" ON "public"."recurring_appointment_series" USING "btree" ("cleaner_id");



CREATE INDEX "idx_recurring_series_homeowner_id" ON "public"."recurring_appointment_series" USING "btree" ("homeowner_id");



CREATE INDEX "idx_recurring_series_is_active" ON "public"."recurring_appointment_series" USING "btree" ("is_active");



CREATE INDEX "idx_recurring_series_organization_id" ON "public"."recurring_appointment_series" USING "btree" ("organization_id");



CREATE INDEX "idx_recurring_series_property_id" ON "public"."recurring_appointment_series" USING "btree" ("property_id");



CREATE INDEX "idx_service_types_is_active" ON "public"."service_types" USING "btree" ("is_active");



CREATE INDEX "idx_service_types_org_active" ON "public"."service_types" USING "btree" ("organization_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_service_types_org_realtime" ON "public"."service_types" USING "btree" ("organization_id");



CREATE INDEX "idx_service_types_organization_id" ON "public"."service_types" USING "btree" ("organization_id");



CREATE INDEX "idx_suggested_times_feedback_id" ON "public"."cleaner_suggested_times" USING "btree" ("feedback_id");



CREATE INDEX "idx_suggested_windows_feedback_id" ON "public"."cleaner_suggested_windows" USING "btree" ("feedback_id");



CREATE INDEX "idx_user_profiles_role" ON "public"."user_profiles" USING "btree" ("role");



CREATE OR REPLACE TRIGGER "create_default_checklist_after_service_insert" AFTER INSERT ON "public"."service_types" FOR EACH ROW EXECUTE FUNCTION "public"."create_default_checklist_for_service"();



CREATE OR REPLACE TRIGGER "trigger_checklist_price_adder_recalc" AFTER UPDATE ON "public"."checklists" FOR EACH ROW EXECUTE FUNCTION "public"."handle_checklist_price_adder_change"();



CREATE OR REPLACE TRIGGER "update_appointments_updated_at" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_checklists_updated_at" BEFORE UPDATE ON "public"."checklists" FOR EACH ROW EXECUTE FUNCTION "public"."update_checklists_updated_at"();



CREATE OR REPLACE TRIGGER "update_cleaner_profiles_updated_at" BEFORE UPDATE ON "public"."cleaner_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_conversation_timestamp" AFTER INSERT ON "public"."messages" FOR EACH ROW WHEN (("new"."conversation_id" IS NOT NULL)) EXECUTE FUNCTION "public"."update_conversation_last_message"();



CREATE OR REPLACE TRIGGER "update_invites_updated_at" BEFORE UPDATE ON "public"."invites" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_manager_permissions_updated_at" BEFORE UPDATE ON "public"."manager_permissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_manager_permissions_updated_at"();



CREATE OR REPLACE TRIGGER "update_properties_updated_at" BEFORE UPDATE ON "public"."properties" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_recurring_appointment_series_updated_at" BEFORE UPDATE ON "public"."recurring_appointment_series" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_service_types_updated_at" BEFORE UPDATE ON "public"."service_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_service_types_updated_at"();



CREATE OR REPLACE TRIGGER "update_user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaner_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_homeowner_id_fkey" FOREIGN KEY ("homeowner_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_appointment_series"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."checklist_line_items"
    ADD CONSTRAINT "checklist_line_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklists"
    ADD CONSTRAINT "checklists_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_availability_feedback"
    ADD CONSTRAINT "cleaner_availability_feedback_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_availability_feedback"
    ADD CONSTRAINT "cleaner_availability_feedback_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaner_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_profiles"
    ADD CONSTRAINT "cleaner_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_profiles"
    ADD CONSTRAINT "cleaner_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."cleaner_suggested_times"
    ADD CONSTRAINT "cleaner_suggested_times_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "public"."cleaner_availability_feedback"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cleaner_suggested_windows"
    ADD CONSTRAINT "cleaner_suggested_windows_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "public"."cleaner_availability_feedback"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_participant_1_id_fkey" FOREIGN KEY ("participant_1_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_participant_2_id_fkey" FOREIGN KEY ("participant_2_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_homeowner_id_fkey" FOREIGN KEY ("homeowner_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."job_photos"
    ADD CONSTRAINT "job_photos_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manager_permissions"
    ADD CONSTRAINT "manager_permissions_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manager_permissions"
    ADD CONSTRAINT "manager_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_attachments"
    ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaner_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."properties"
    ADD CONSTRAINT "properties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."properties"
    ADD CONSTRAINT "properties_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_appointment_series"
    ADD CONSTRAINT "recurring_appointment_series_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "public"."checklists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recurring_appointment_series"
    ADD CONSTRAINT "recurring_appointment_series_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "public"."cleaner_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recurring_appointment_series"
    ADD CONSTRAINT "recurring_appointment_series_homeowner_id_fkey" FOREIGN KEY ("homeowner_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_appointment_series"
    ADD CONSTRAINT "recurring_appointment_series_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_appointment_series"
    ADD CONSTRAINT "recurring_appointment_series_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_appointment_series"
    ADD CONSTRAINT "recurring_appointment_series_service_type_id_fkey" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewee_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_types"
    ADD CONSTRAINT "service_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admin can delete invoices in their organization" ON "public"."invoices" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invoices"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can delete payouts in their organization" ON "public"."payouts" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "payouts"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can delete series in their organization" ON "public"."recurring_appointment_series" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can insert invoices in their organization" ON "public"."invoices" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invoices"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can insert payouts in their organization" ON "public"."payouts" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "payouts"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can insert series in their organization" ON "public"."recurring_appointment_series" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can update invoices in their organization" ON "public"."invoices" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invoices"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can update payouts in their organization" ON "public"."payouts" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "payouts"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can update series in their organization" ON "public"."recurring_appointment_series" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can view all invoices in their organization" ON "public"."invoices" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invoices"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can view all payouts in their organization" ON "public"."payouts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."user_profiles" "up" ON (("om"."user_id" = "up"."id")))
  WHERE (("om"."organization_id" = "payouts"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admin can view all series in their organization" ON "public"."recurring_appointment_series" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND (("om"."role" = 'admin'::"public"."org_role") OR ("om"."role" = 'owner'::"public"."org_role"))))));



CREATE POLICY "Admins and managers can create checklist line items" ON "public"."checklist_line_items" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."checklists" "c"
     JOIN "public"."service_types" "st" ON (("st"."id" = "c"."service_type_id")))
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("c"."id" = "checklist_line_items"."checklist_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can create checklists" ON "public"."checklists" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."service_types" "st"
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("st"."id" = "checklists"."service_type_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can create service types" ON "public"."service_types" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "service_types"."organization_id") AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can delete checklist line items" ON "public"."checklist_line_items" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (("public"."checklists" "c"
     JOIN "public"."service_types" "st" ON (("st"."id" = "c"."service_type_id")))
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("c"."id" = "checklist_line_items"."checklist_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can delete checklists" ON "public"."checklists" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."service_types" "st"
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("st"."id" = "checklists"."service_type_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can delete org properties" ON "public"."properties" FOR DELETE USING ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om_viewer"
  WHERE (("om_viewer"."user_id" = "auth"."uid"()) AND ("om_viewer"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])) AND (EXISTS ( SELECT 1
           FROM "public"."organization_members" "om_target"
          WHERE (("om_target"."user_id" = "properties"."owner_id") AND ("om_target"."role" = 'homeowner'::"public"."org_role") AND ("om_target"."organization_id" = "om_viewer"."organization_id")))))))));



CREATE POLICY "Admins and managers can delete service types" ON "public"."service_types" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "service_types"."organization_id") AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can insert org properties" ON "public"."properties" FOR INSERT WITH CHECK ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om_viewer"
  WHERE (("om_viewer"."user_id" = "auth"."uid"()) AND ("om_viewer"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])) AND (EXISTS ( SELECT 1
           FROM "public"."organization_members" "om_target"
          WHERE (("om_target"."user_id" = "properties"."owner_id") AND ("om_target"."role" = 'homeowner'::"public"."org_role") AND ("om_target"."organization_id" = "om_viewer"."organization_id")))))))));



CREATE POLICY "Admins and managers can update checklist line items" ON "public"."checklist_line_items" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (("public"."checklists" "c"
     JOIN "public"."service_types" "st" ON (("st"."id" = "c"."service_type_id")))
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("c"."id" = "checklist_line_items"."checklist_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."checklists" "c"
     JOIN "public"."service_types" "st" ON (("st"."id" = "c"."service_type_id")))
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("c"."id" = "checklist_line_items"."checklist_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can update checklists" ON "public"."checklists" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."service_types" "st"
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("st"."id" = "checklists"."service_type_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."service_types" "st"
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("st"."id" = "checklists"."service_type_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can update org appointments" ON "public"."appointments" FOR UPDATE USING ((("auth"."uid"() = "homeowner_id") OR ("auth"."uid"() = "cleaner_id") OR (("organization_id" IS NOT NULL) AND "public"."is_admin_or_manager_in_org"("organization_id")) OR "public"."user_shares_org_with_homeowner"("homeowner_id")));



CREATE POLICY "Admins and managers can update org cleaner profiles" ON "public"."cleaner_profiles" FOR UPDATE USING ((("auth"."uid"() = "id") OR "public"."can_admin_update_cleaner_profile"("auth"."uid"(), "id")));



CREATE POLICY "Admins and managers can update org properties" ON "public"."properties" FOR UPDATE USING ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om_viewer"
  WHERE (("om_viewer"."user_id" = "auth"."uid"()) AND ("om_viewer"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])) AND (EXISTS ( SELECT 1
           FROM "public"."organization_members" "om_target"
          WHERE (("om_target"."user_id" = "properties"."owner_id") AND ("om_target"."role" = 'homeowner'::"public"."org_role") AND ("om_target"."organization_id" = "om_viewer"."organization_id")))))))));



CREATE POLICY "Admins and managers can update org user profiles" ON "public"."user_profiles" FOR UPDATE USING ((("auth"."uid"() = "id") OR "public"."can_admin_update_user_profile"("auth"."uid"(), "id")));



CREATE POLICY "Admins and managers can update service types" ON "public"."service_types" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "service_types"."organization_id") AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."user_id" = "auth"."uid"()) AND ("om"."organization_id" = "service_types"."organization_id") AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Admins and managers can view org appointments" ON "public"."appointments" FOR SELECT USING ((("auth"."uid"() = "homeowner_id") OR ("auth"."uid"() = "cleaner_id") OR (("organization_id" IS NOT NULL) AND "public"."is_admin_or_manager_in_org"("organization_id")) OR "public"."user_shares_org_with_homeowner"("homeowner_id")));



CREATE POLICY "Admins and managers can view org properties" ON "public"."properties" FOR SELECT USING ((("auth"."uid"() = "owner_id") OR (EXISTS ( SELECT 1
   FROM "public"."organization_members" "om_viewer"
  WHERE (("om_viewer"."user_id" = "auth"."uid"()) AND ("om_viewer"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])) AND (EXISTS ( SELECT 1
           FROM "public"."organization_members" "om_target"
          WHERE (("om_target"."user_id" = "properties"."owner_id") AND ("om_target"."role" = 'homeowner'::"public"."org_role") AND ("om_target"."organization_id" = "om_viewer"."organization_id")))))))));



CREATE POLICY "Admins can delete manager permissions in their organization" ON "public"."manager_permissions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."organization_id" = "manager_permissions"."organization_id") AND ("organization_members"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role"]))))));



CREATE POLICY "Admins can delete organization members" ON "public"."organization_members" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can delete properties" ON "public"."properties" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can insert appointments" ON "public"."appointments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can insert manager permissions in their organization" ON "public"."manager_permissions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."organization_id" = "manager_permissions"."organization_id") AND ("organization_members"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role"]))))));



CREATE POLICY "Admins can insert organization members" ON "public"."organization_members" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can insert properties" ON "public"."properties" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can update any appointment" ON "public"."appointments" FOR UPDATE USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Admins can update manager permissions in their organization" ON "public"."manager_permissions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."organization_id" = "manager_permissions"."organization_id") AND ("organization_members"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role"]))))));



CREATE POLICY "Admins can update organization members" ON "public"."organization_members" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can update properties" ON "public"."properties" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can view all appointments" ON "public"."appointments" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Admins can view all cleaner profiles" ON "public"."cleaner_profiles" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Admins can view all messages" ON "public"."messages" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Admins can view all organization members" ON "public"."organization_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can view all organizations" ON "public"."organizations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can view all payments" ON "public"."payments" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Admins can view all properties" ON "public"."properties" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins can view all user profiles" ON "public"."user_profiles" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'admin'::"text"));



CREATE POLICY "Admins can view manager permissions in their organization" ON "public"."manager_permissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members"
  WHERE (("organization_members"."user_id" = "auth"."uid"()) AND ("organization_members"."organization_id" = "manager_permissions"."organization_id") AND ("organization_members"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role"]))))));



CREATE POLICY "Anyone can view cleaner profiles" ON "public"."cleaner_profiles" FOR SELECT USING (true);



CREATE POLICY "Cleaner can view their assigned series" ON "public"."recurring_appointment_series" FOR SELECT TO "authenticated" USING (("cleaner_id" = "auth"."uid"()));



CREATE POLICY "Cleaner can view their own payouts" ON "public"."payouts" FOR SELECT TO "authenticated" USING (("cleaner_id" = "auth"."uid"()));



CREATE POLICY "Cleaners can delete own appointment photos" ON "public"."job_photos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."id" = "job_photos"."appointment_id") AND ("appointments"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Cleaners can insert own appointment photos" ON "public"."job_photos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."id" = "job_photos"."appointment_id") AND ("appointments"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Cleaners can insert their own feedback" ON "public"."cleaner_availability_feedback" FOR INSERT WITH CHECK (("auth"."uid"() = "cleaner_id"));



CREATE POLICY "Cleaners can insert their own profile" ON "public"."cleaner_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Cleaners can update appointment status" ON "public"."appointments" FOR UPDATE USING (("auth"."uid"() = "cleaner_id"));



CREATE POLICY "Cleaners can update their own profile" ON "public"."cleaner_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Cleaners can view homeowner profiles for their appointments" ON "public"."user_profiles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."homeowner_id" = "user_profiles"."id") AND ("appointments"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Cleaners can view own appointment photos" ON "public"."job_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."id" = "job_photos"."appointment_id") AND ("appointments"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Cleaners can view properties for their appointments" ON "public"."properties" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."property_id" = "properties"."id") AND ("appointments"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Cleaners can view their appointments" ON "public"."appointments" FOR SELECT USING (("auth"."uid"() = "cleaner_id"));



CREATE POLICY "Cleaners can view their own feedback" ON "public"."cleaner_availability_feedback" FOR SELECT USING (("auth"."uid"() = "cleaner_id"));



CREATE POLICY "Cleaners can view their own profile" ON "public"."cleaner_profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Homeowner can view their own invoices" ON "public"."invoices" FOR SELECT TO "authenticated" USING (("homeowner_id" = "auth"."uid"()));



CREATE POLICY "Homeowner can view their own series" ON "public"."recurring_appointment_series" FOR SELECT TO "authenticated" USING (("homeowner_id" = "auth"."uid"()));



CREATE POLICY "Homeowners can create appointments" ON "public"."appointments" FOR INSERT WITH CHECK (("auth"."uid"() = "homeowner_id"));



COMMENT ON POLICY "Homeowners can create appointments" ON "public"."appointments" IS 'Allows homeowners to create appointments for themselves. Verifies that auth.uid() matches homeowner_id.';



CREATE POLICY "Homeowners can manage their own properties" ON "public"."properties" USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Homeowners can update their appointments" ON "public"."appointments" FOR UPDATE USING (("auth"."uid"() = "homeowner_id"));



CREATE POLICY "Homeowners can view photos for their appointments" ON "public"."job_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."id" = "job_photos"."appointment_id") AND ("appointments"."homeowner_id" = "auth"."uid"())))));



CREATE POLICY "Homeowners can view their appointments" ON "public"."appointments" FOR SELECT USING (("auth"."uid"() = "homeowner_id"));



CREATE POLICY "Homeowners can view their own properties" ON "public"."properties" FOR SELECT USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Manager can delete series if permitted" ON "public"."recurring_appointment_series" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_edit_bookings" = true)))));



CREATE POLICY "Manager can insert series if permitted" ON "public"."recurring_appointment_series" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_edit_bookings" = true)))));



CREATE POLICY "Manager can update invoices if permitted" ON "public"."invoices" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "invoices"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_manage_payments" = true)))));



CREATE POLICY "Manager can update payouts if permitted" ON "public"."payouts" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "payouts"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_manage_payments" = true)))));



CREATE POLICY "Manager can update series if permitted" ON "public"."recurring_appointment_series" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_edit_bookings" = true)))));



CREATE POLICY "Manager can view invoices if permitted" ON "public"."invoices" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "invoices"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_view_payments" = true)))));



CREATE POLICY "Manager can view payouts if permitted" ON "public"."payouts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "payouts"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_view_payments" = true)))));



CREATE POLICY "Manager can view series if permitted" ON "public"."recurring_appointment_series" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om"
     JOIN "public"."manager_permissions" "mp" ON (("om"."user_id" = "mp"."manager_id")))
  WHERE (("om"."organization_id" = "recurring_appointment_series"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'manager'::"public"."org_role") AND ("mp"."can_view_bookings" = true)))));



CREATE POLICY "Managers can insert appointments" ON "public"."appointments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));



CREATE POLICY "Managers can send messages" ON "public"."messages" FOR INSERT WITH CHECK ((((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'manager'::"text") AND ("auth"."uid"() = "sender_id")));



CREATE POLICY "Managers can update any appointment" ON "public"."appointments" FOR UPDATE USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



CREATE POLICY "Managers can update appointments" ON "public"."appointments" FOR UPDATE USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'manager'::"text"));



CREATE POLICY "Managers can update cleaner profiles" ON "public"."cleaner_profiles" FOR UPDATE USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = 'manager'::"text"));



CREATE POLICY "Managers can view all appointments" ON "public"."appointments" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



CREATE POLICY "Managers can view all cleaner profiles" ON "public"."cleaner_profiles" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



CREATE POLICY "Managers can view all job photos in their org" ON "public"."job_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."appointments" "a"
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "a"."organization_id")))
  WHERE (("a"."id" = "job_photos"."appointment_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Managers can view all messages" ON "public"."messages" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



CREATE POLICY "Managers can view all payments" ON "public"."payments" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



CREATE POLICY "Managers can view all properties" ON "public"."properties" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));



CREATE POLICY "Managers can view all user profiles" ON "public"."user_profiles" FOR SELECT USING (((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



CREATE POLICY "Managers can view organization members" ON "public"."organization_members" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));



CREATE POLICY "Managers can view their own permissions" ON "public"."manager_permissions" FOR SELECT USING (("auth"."uid"() = "manager_id"));



CREATE POLICY "Org admins and managers can delete appointments" ON "public"."appointments" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "appointments"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))));



CREATE POLICY "Participants can view message attachments" ON "public"."message_attachments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."messages" "m"
  WHERE (("m"."id" = "message_attachments"."message_id") AND (("auth"."uid"() = "m"."sender_id") OR ("auth"."uid"() = "m"."recipient_id"))))));



CREATE POLICY "Property owner or org admin/manager can update property photo_u" ON "public"."properties" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om_owner"
     JOIN "public"."organization_members" "om_actor" ON (("om_actor"."organization_id" = "om_owner"."organization_id")))
  WHERE (("om_owner"."user_id" = "properties"."owner_id") AND ("om_actor"."user_id" = "auth"."uid"()) AND ("om_actor"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"]))))))) WITH CHECK ((("owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."organization_members" "om_owner"
     JOIN "public"."organization_members" "om_actor" ON (("om_actor"."organization_id" = "om_owner"."organization_id")))
  WHERE (("om_owner"."user_id" = "properties"."owner_id") AND ("om_actor"."user_id" = "auth"."uid"()) AND ("om_actor"."role" = ANY (ARRAY['owner'::"public"."org_role", 'admin'::"public"."org_role", 'manager'::"public"."org_role"])))))));



CREATE POLICY "Sender can delete message attachments" ON "public"."message_attachments" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."messages" "m"
  WHERE (("m"."id" = "message_attachments"."message_id") AND ("m"."sender_id" = "auth"."uid"())))));



CREATE POLICY "Sender can insert message attachments" ON "public"."message_attachments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."messages" "m"
  WHERE (("m"."id" = "message_attachments"."message_id") AND ("m"."sender_id" = "auth"."uid"())))));



CREATE POLICY "Users can create attachments for their messages" ON "public"."message_attachments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."messages"
  WHERE (("messages"."id" = "message_attachments"."message_id") AND ("messages"."sender_id" = "auth"."uid"())))));



CREATE POLICY "Users can create conversations" ON "public"."conversations" FOR INSERT WITH CHECK ((("auth"."uid"() = "participant_1_id") OR ("auth"."uid"() = "participant_2_id")));



CREATE POLICY "Users can create reviews for their appointments" ON "public"."reviews" FOR INSERT WITH CHECK ((("auth"."uid"() = "reviewer_id") AND (EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."id" = "reviews"."appointment_id") AND (("appointments"."homeowner_id" = "auth"."uid"()) OR ("appointments"."cleaner_id" = "auth"."uid"())))))));



CREATE POLICY "Users can delete their own conversations" ON "public"."conversations" FOR DELETE USING ((("auth"."uid"() = "participant_1_id") OR ("auth"."uid"() = "participant_2_id")));



CREATE POLICY "Users can insert suggested times for their feedback" ON "public"."cleaner_suggested_times" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cleaner_availability_feedback" "f"
  WHERE (("f"."id" = "cleaner_suggested_times"."feedback_id") AND ("f"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert suggested windows for their feedback" ON "public"."cleaner_suggested_windows" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cleaner_availability_feedback" "f"
  WHERE (("f"."id" = "cleaner_suggested_windows"."feedback_id") AND ("f"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert their own profile" ON "public"."user_profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can send messages" ON "public"."messages" FOR INSERT WITH CHECK ((("auth"."uid"() = "sender_id") AND "public"."can_message_user"("recipient_id")));



CREATE POLICY "Users can update their own conversations" ON "public"."conversations" FOR UPDATE USING ((("auth"."uid"() = "participant_1_id") OR ("auth"."uid"() = "participant_2_id")));



CREATE POLICY "Users can update their own profile" ON "public"."user_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update their received messages" ON "public"."messages" FOR UPDATE USING (("auth"."uid"() = "recipient_id")) WITH CHECK (("auth"."uid"() = "recipient_id"));



CREATE POLICY "Users can view attachments of their messages" ON "public"."message_attachments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."messages"
  WHERE (("messages"."id" = "message_attachments"."message_id") AND (("messages"."sender_id" = "auth"."uid"()) OR ("messages"."recipient_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view checklist line items in their organization" ON "public"."checklist_line_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (("public"."checklists" "c"
     JOIN "public"."service_types" "st" ON (("st"."id" = "c"."service_type_id")))
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("c"."id" = "checklist_line_items"."checklist_id") AND ("om"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view checklists in their organization" ON "public"."checklists" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."service_types" "st"
     JOIN "public"."organization_members" "om" ON (("om"."organization_id" = "st"."organization_id")))
  WHERE (("st"."id" = "checklists"."service_type_id") AND ("om"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view members of their organization" ON "public"."organization_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("organization_id" = ANY ("public"."get_user_organization_ids"("auth"."uid"())))));



CREATE POLICY "Users can view messages in their conversations" ON "public"."messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE (("conversations"."id" = "messages"."conversation_id") AND (("conversations"."participant_1_id" = "auth"."uid"()) OR ("conversations"."participant_2_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view payments for their appointments" ON "public"."payments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."appointments"
  WHERE (("appointments"."id" = "payments"."appointment_id") AND (("appointments"."homeowner_id" = "auth"."uid"()) OR ("appointments"."cleaner_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view profiles of conversation participants" ON "public"."user_profiles" FOR SELECT USING ((("auth"."uid"() = "id") OR (EXISTS ( SELECT 1
   FROM "public"."conversations"
  WHERE ((("conversations"."participant_1_id" = "auth"."uid"()) AND ("conversations"."participant_2_id" = "user_profiles"."id")) OR (("conversations"."participant_2_id" = "auth"."uid"()) AND ("conversations"."participant_1_id" = "user_profiles"."id")))))));



CREATE POLICY "Users can view profiles of message contacts" ON "public"."user_profiles" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."messages"
  WHERE ((("messages"."sender_id" = "user_profiles"."id") AND ("messages"."recipient_id" = "auth"."uid"())) OR (("messages"."recipient_id" = "user_profiles"."id") AND ("messages"."sender_id" = "auth"."uid"()))))));



CREATE POLICY "Users can view profiles of organization members" ON "public"."user_profiles" FOR SELECT USING ((("auth"."uid"() = "id") OR "public"."users_share_organization"("auth"."uid"(), "id")));



CREATE POLICY "Users can view reviews" ON "public"."reviews" FOR SELECT USING (true);



CREATE POLICY "Users can view service types in their organization" ON "public"."service_types" FOR SELECT USING (("organization_id" IN ( SELECT "organization_members"."organization_id"
   FROM "public"."organization_members"
  WHERE ("organization_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view suggested times for their feedback" ON "public"."cleaner_suggested_times" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cleaner_availability_feedback" "f"
  WHERE (("f"."id" = "cleaner_suggested_times"."feedback_id") AND ("f"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Users can view suggested windows for their feedback" ON "public"."cleaner_suggested_windows" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."cleaner_availability_feedback" "f"
  WHERE (("f"."id" = "cleaner_suggested_windows"."feedback_id") AND ("f"."cleaner_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their messages" ON "public"."messages" FOR SELECT USING ((("auth"."uid"() = "sender_id") OR ("auth"."uid"() = "recipient_id")));



CREATE POLICY "Users can view their organizations" ON "public"."organizations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "organizations"."id") AND ("om"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own conversations" ON "public"."conversations" FOR SELECT USING ((("auth"."uid"() = "participant_1_id") OR ("auth"."uid"() = "participant_2_id")));



CREATE POLICY "Users can view their own memberships" ON "public"."organization_members" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."user_profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checklist_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checklists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_availability_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_suggested_times" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cleaner_suggested_windows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delete_org_members_self" ON "public"."organization_members" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_organizations" ON "public"."organizations" FOR DELETE USING (("created_by" = "auth"."uid"()));



CREATE POLICY "insert_org_members" ON "public"."organization_members" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."organizations" "o"
  WHERE (("o"."id" = "organization_members"."organization_id") AND ("o"."created_by" = "auth"."uid"()))))));



CREATE POLICY "insert_organizations" ON "public"."organizations" FOR INSERT WITH CHECK ((("auth"."role"() = 'authenticated'::"text") AND ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."job_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."manager_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org admins can create invites" ON "public"."invites" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invites"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'admin'::"public"."org_role")))) AND ("invited_by" = "auth"."uid"())));



CREATE POLICY "org admins can delete invites" ON "public"."invites" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invites"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'admin'::"public"."org_role")))));



CREATE POLICY "org admins can update invites" ON "public"."invites" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invites"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'admin'::"public"."org_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invites"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'admin'::"public"."org_role")))));



CREATE POLICY "org admins can view invites" ON "public"."invites" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "om"
  WHERE (("om"."organization_id" = "invites"."organization_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."role" = 'admin'::"public"."org_role")))));



ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."properties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurring_appointment_series" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_org_members_self" ON "public"."organization_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "select_organizations" ON "public"."organizations" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."organization_members" "m"
  WHERE (("m"."organization_id" = "organizations"."id") AND ("m"."user_id" = "auth"."uid"())))) OR ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."service_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_org_members_self" ON "public"."organization_members" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_organizations" ON "public"."organizations" FOR UPDATE USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_dashboard_stats"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_dashboard_stats"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_dashboard_stats"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_update_cleaner_payouts"("updates" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_update_cleaner_payouts"("updates" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_update_cleaner_payouts"("updates" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_admin_update_cleaner_profile"("admin_user_id" "uuid", "cleaner_profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_admin_update_cleaner_profile"("admin_user_id" "uuid", "cleaner_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_admin_update_cleaner_profile"("admin_user_id" "uuid", "cleaner_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_admin_update_user_profile"("admin_user_id" "uuid", "target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_admin_update_user_profile"("admin_user_id" "uuid", "target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_admin_update_user_profile"("admin_user_id" "uuid", "target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_admin_view_appointment"("admin_user_id" "uuid", "appointment_homeowner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_admin_view_appointment"("admin_user_id" "uuid", "appointment_homeowner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_admin_view_appointment"("admin_user_id" "uuid", "appointment_homeowner_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_message_role"("viewer_role" "public"."user_role", "target_role" "public"."user_role") TO "anon";
GRANT ALL ON FUNCTION "public"."can_message_role"("viewer_role" "public"."user_role", "target_role" "public"."user_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_message_role"("viewer_role" "public"."user_role", "target_role" "public"."user_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_message_user"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_message_user"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_message_user"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleaner_stats"("p_cleaner_id" "uuid", "p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cleaner_stats"("p_cleaner_id" "uuid", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleaner_stats"("p_cleaner_id" "uuid", "p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_default_checklist_for_service"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_default_checklist_for_service"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_default_checklist_for_service"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("user1_id" "uuid", "user2_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("user1_id" "uuid", "user2_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_conversation"("user1_id" "uuid", "user2_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_organization_ids"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_organization_ids"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_organization_ids"("check_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_checklist_price_adder_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_checklist_price_adder_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_checklist_price_adder_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_or_manager_in_org"("check_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_or_manager_in_org"("check_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_or_manager_in_org"("check_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."org_customers_with_counts"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."org_customers_with_counts"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."org_customers_with_counts"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."payment_stats"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."payment_stats"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."payment_stats"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_totals_for_checklist"("p_checklist_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_totals_for_checklist"("p_checklist_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_totals_for_checklist"("p_checklist_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_checklists_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_checklists_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_checklists_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_conversation_last_message"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_conversation_last_message"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_conversation_last_message"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_manager_permissions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_manager_permissions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_manager_permissions_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_service_types_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_service_types_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_service_types_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_shares_org_with_homeowner"("check_homeowner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_shares_org_with_homeowner"("check_homeowner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_shares_org_with_homeowner"("check_homeowner_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."users_share_organization"("user1_id" "uuid", "user2_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."users_share_organization"("user1_id" "uuid", "user2_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."users_share_organization"("user1_id" "uuid", "user2_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_line_items" TO "anon";
GRANT ALL ON TABLE "public"."checklist_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."checklists" TO "anon";
GRANT ALL ON TABLE "public"."checklists" TO "authenticated";
GRANT ALL ON TABLE "public"."checklists" TO "service_role";



GRANT ALL ON TABLE "public"."cleaner_availability_feedback" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_availability_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_availability_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."cleaner_profiles" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."cleaner_suggested_times" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_suggested_times" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_suggested_times" TO "service_role";



GRANT ALL ON TABLE "public"."cleaner_suggested_windows" TO "anon";
GRANT ALL ON TABLE "public"."cleaner_suggested_windows" TO "authenticated";
GRANT ALL ON TABLE "public"."cleaner_suggested_windows" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."invites" TO "anon";
GRANT ALL ON TABLE "public"."invites" TO "authenticated";
GRANT ALL ON TABLE "public"."invites" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."job_photos" TO "anon";
GRANT ALL ON TABLE "public"."job_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."job_photos" TO "service_role";



GRANT ALL ON TABLE "public"."manager_permissions" TO "anon";
GRANT ALL ON TABLE "public"."manager_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."manager_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."message_attachments" TO "anon";
GRANT ALL ON TABLE "public"."message_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."message_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";



GRANT ALL ON TABLE "public"."properties" TO "anon";
GRANT ALL ON TABLE "public"."properties" TO "authenticated";
GRANT ALL ON TABLE "public"."properties" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_appointment_series" TO "anon";
GRANT ALL ON TABLE "public"."recurring_appointment_series" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_appointment_series" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."service_types" TO "anon";
GRANT ALL ON TABLE "public"."service_types" TO "authenticated";
GRANT ALL ON TABLE "public"."service_types" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






