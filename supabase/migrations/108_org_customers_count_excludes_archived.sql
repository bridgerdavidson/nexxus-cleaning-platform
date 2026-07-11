-- 108: exclude archived properties from the org_customers_with_counts fast path (R4).
-- The RPC's properties_count subquery counted archived rows, inflating a customer's
-- property count after a property is archived. Mirror the archived_at read filter.

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
      and archived_at is null
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
