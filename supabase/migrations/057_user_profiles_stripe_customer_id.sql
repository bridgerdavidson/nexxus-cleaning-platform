-- The `000_baseline.sql` dump from the prod project did not capture
-- `user_profiles.stripe_customer_id` (it was added via Supabase Studio,
-- not a tracked migration). Add it explicitly so local + dev + prod all
-- agree on schema. `IF NOT EXISTS` makes this safe to apply against
-- remotes where the column already exists.

ALTER TABLE "public"."user_profiles"
    ADD COLUMN IF NOT EXISTS "stripe_customer_id" "text";
