-- 072_connect_account_idempotency.sql
-- Race-safe Stripe Connect account creation for tenants AND cleaners.
--
-- Problem this fixes:
--   The /api/stripe/tenant/connect/start and /api/stripe/connect/cleaner/start
--   routes used a non-atomic read-then-write guard around `stripe.accounts.create()`.
--   When the embedded onboarding component re-fetched its client secret while the
--   first round-trip was in flight, both requests saw the column NULL, both called
--   Stripe, both got fresh account IDs, last write to DB won, and one account was
--   orphaned in the platform's Stripe dashboard (incident 2026-05-28).
--
-- Fix shape:
--   1) Two trios of RPCs (one per table) that atomically claim/commit/release a
--      `pending:<uuid>` placeholder under SELECT … FOR UPDATE, so a concurrent
--      caller sees the slot is already taken and backs off.
--   2) CHECK constraints permitting the new `pending:<uuid>` token form alongside
--      the existing `acct_*` IDs.
--   3) `connect_account_drift_events` ledger so /refresh-status and the webhook
--      handler can surface a mismatch when the live account ID differs from the
--      one we stored (manual reconcile only — no auto-rewrite).
--
-- ADDITIVE ONLY. Safe to run on a populated database.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Permit `pending:<uuid>` token form on both connect-account columns.
--    The existing partial UNIQUE indexes are still respected (each token uses a
--    fresh UUID, so no collisions).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_stripe_connect_account_id_format_chk;
ALTER TABLE public.organizations
  ADD  CONSTRAINT organizations_stripe_connect_account_id_format_chk
  CHECK (
    stripe_connect_account_id IS NULL
    OR stripe_connect_account_id LIKE 'acct_%'
    OR stripe_connect_account_id LIKE 'pending:%'
  );

ALTER TABLE public.cleaner_profiles
  DROP CONSTRAINT IF EXISTS cleaner_profiles_stripe_connect_account_id_format_chk;
ALTER TABLE public.cleaner_profiles
  ADD  CONSTRAINT cleaner_profiles_stripe_connect_account_id_format_chk
  CHECK (
    stripe_connect_account_id IS NULL
    OR stripe_connect_account_id LIKE 'acct_%'
    OR stripe_connect_account_id LIKE 'pending:%'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tenant (organizations) claim/commit/release RPCs.
--    SECURITY INVOKER — callers are always supabaseAdmin (service role) which
--    bypasses RLS. Functions use SELECT … FOR UPDATE on the org row to serialize
--    concurrent claims.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_org_connect_slot(p_org_id uuid)
RETURNS TABLE(account_id text, claimed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current text;
  v_pending text;
BEGIN
  SELECT o.stripe_connect_account_id INTO v_current
  FROM public.organizations o
  WHERE o.id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization not found: %', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF v_current IS NOT NULL THEN
    -- Already claimed: could be a real acct_* or another in-flight pending:<uuid>.
    -- Caller decides what to do based on the prefix.
    RETURN QUERY SELECT v_current, false;
  ELSE
    v_pending := 'pending:' || gen_random_uuid()::text;
    UPDATE public.organizations
       SET stripe_connect_account_id = v_pending
     WHERE id = p_org_id;
    RETURN QUERY SELECT v_pending, true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_org_connect_slot(
  p_org_id uuid, p_pending_token text, p_real_account_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_real_account_id IS NULL OR p_real_account_id NOT LIKE 'acct_%' THEN
    RAISE EXCEPTION 'p_real_account_id must be a Stripe acct_* id, got: %', p_real_account_id;
  END IF;
  UPDATE public.organizations
     SET stripe_connect_account_id = p_real_account_id
   WHERE id = p_org_id
     AND stripe_connect_account_id = p_pending_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_org_connect_slot(
  p_org_id uuid, p_pending_token text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.organizations
     SET stripe_connect_account_id = NULL
   WHERE id = p_org_id
     AND stripe_connect_account_id = p_pending_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cleaner (cleaner_profiles) claim/commit/release RPCs. Same shape.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_cleaner_connect_slot(p_cleaner_id uuid)
RETURNS TABLE(account_id text, claimed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current text;
  v_pending text;
BEGIN
  SELECT c.stripe_connect_account_id INTO v_current
  FROM public.cleaner_profiles c
  WHERE c.id = p_cleaner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cleaner not found: %', p_cleaner_id USING ERRCODE = 'P0002';
  END IF;

  IF v_current IS NOT NULL THEN
    RETURN QUERY SELECT v_current, false;
  ELSE
    v_pending := 'pending:' || gen_random_uuid()::text;
    UPDATE public.cleaner_profiles
       SET stripe_connect_account_id = v_pending
     WHERE id = p_cleaner_id;
    RETURN QUERY SELECT v_pending, true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_cleaner_connect_slot(
  p_cleaner_id uuid, p_pending_token text, p_real_account_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_real_account_id IS NULL OR p_real_account_id NOT LIKE 'acct_%' THEN
    RAISE EXCEPTION 'p_real_account_id must be a Stripe acct_* id, got: %', p_real_account_id;
  END IF;
  UPDATE public.cleaner_profiles
     SET stripe_connect_account_id = p_real_account_id
   WHERE id = p_cleaner_id
     AND stripe_connect_account_id = p_pending_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cleaner_connect_slot(
  p_cleaner_id uuid, p_pending_token text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.cleaner_profiles
     SET stripe_connect_account_id = NULL
   WHERE id = p_cleaner_id
     AND stripe_connect_account_id = p_pending_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. connect_account_drift_events — manual-reconcile ledger.
--    Inserted by /refresh-status (source 'refresh-status') and the
--    `account.updated` webhook handler (source 'webhook'). Resolved when the
--    platform admin runs `/api/platform/tenants/[id]/connect/reset` (source 'manual')
--    or otherwise updates the stored account id to match. RLS enabled with no
--    policies — service role only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_account_drift_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid REFERENCES public.organizations(id)    ON DELETE CASCADE,
  cleaner_id          uuid REFERENCES public.cleaner_profiles(id) ON DELETE CASCADE,
  expected_account_id text,
  observed_account_id text NOT NULL,
  source              text NOT NULL,
  detected_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT connect_account_drift_events_source_chk
    CHECK (source IN ('webhook','refresh-status','manual')),
  CONSTRAINT connect_account_drift_events_subject_chk
    CHECK ((organization_id IS NOT NULL) <> (cleaner_id IS NOT NULL))
);

-- Open (unresolved) drift per subject — what the UI banner queries.
CREATE INDEX IF NOT EXISTS connect_account_drift_events_open_org_idx
  ON public.connect_account_drift_events (organization_id)
  WHERE organization_id IS NOT NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS connect_account_drift_events_open_cleaner_idx
  ON public.connect_account_drift_events (cleaner_id)
  WHERE cleaner_id IS NOT NULL AND resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS connect_account_drift_events_detected_idx
  ON public.connect_account_drift_events (detected_at);

ALTER TABLE public.connect_account_drift_events ENABLE ROW LEVEL SECURITY;
-- Owners/admins of the affected org can SELECT their own open drift events so the
-- embedded onboarding UI can render the "we detected a Stripe account mismatch"
-- banner without a server round-trip. INSERT/UPDATE remain service-role only.
DROP POLICY IF EXISTS "org owners admins read drift" ON public.connect_account_drift_events;
CREATE POLICY "org owners admins read drift" ON public.connect_account_drift_events
  FOR SELECT TO authenticated USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.organization_members om
       WHERE om.organization_id = connect_account_drift_events.organization_id
         AND om.user_id = auth.uid()
         AND om.role IN ('owner','admin')));

COMMIT;
