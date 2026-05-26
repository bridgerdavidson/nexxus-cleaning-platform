-- 065_stripe_restructure.sql
-- Stripe payment architecture restructure — SCHEMA GROUNDWORK (Phase 0).
--
-- ADDITIVE ONLY. No column drops, no behavior change. Safe to run on a populated
-- database. Establishes:
--   • tenant (organization) Stripe Connect identity + SaaS-billing customer + policy config
--   • per-cleaner payout model (percentage_contractor | hourly_external)
--   • appointment-level authorization + cancellation state
--   • destination-charge accounting columns on payments
--   • two-leg payout audit columns on payouts (+ backfill organization_id, then NOT NULL)
--   • supporting tables: homeowner_payment_links, refunds, disputes, application_fees,
--     payment_events (forensic ledger), webhook_events (idempotency), tenant_subscription_events
--
-- Status-ish columns use text + CHECK rather than new ENUM types: the value sets
-- (subscription_status, authorization_status, etc.) are expected to evolve, and
-- text+CHECK avoids the non-transactional ALTER TYPE ... ADD VALUE migration pain.
--
-- RPC changes (payment_stats refund-awareness, org_stripe_status) are intentionally
-- DEFERRED to the phases that consume them (4 and 1) to keep this migration
-- behavior-neutral.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Shared updated_at trigger (baseline manages updated_at manually; new tables
--    get auto-maintenance so route/webhook code can't forget to bump it).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. organizations — tenant Stripe identity, SaaS billing, fee + policy config
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id        text,
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled   boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled   boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_details_submitted boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at      timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_connect_requirements_due  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stripe_customer_id               text,
  ADD COLUMN IF NOT EXISTS subscription_status              text         NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS subscription_id                  text,
  ADD COLUMN IF NOT EXISTS subscription_current_period_end  timestamptz,
  ADD COLUMN IF NOT EXISTS platform_fee_bps                 integer      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_payout_model             text         NOT NULL DEFAULT 'percentage_contractor',
  ADD COLUMN IF NOT EXISTS cancellation_window_hours        integer      NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS cancellation_fee_type            text         NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cancellation_fee_value           numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_email                    text;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_subscription_status_chk
  CHECK (subscription_status IN ('none','trialing','active','past_due','canceled'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_default_payout_model_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_default_payout_model_chk
  CHECK (default_payout_model IN ('percentage_contractor','hourly_external'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_cancellation_fee_type_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_cancellation_fee_type_chk
  CHECK (cancellation_fee_type IN ('none','flat','percent'));

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_platform_fee_bps_chk;
ALTER TABLE public.organizations ADD  CONSTRAINT organizations_platform_fee_bps_chk
  CHECK (platform_fee_bps >= 0 AND platform_fee_bps <= 10000);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_connect_account_id_key
  ON public.organizations (stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer_id_key
  ON public.organizations (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. cleaner_profiles — payout model (contractor with % vs hourly paid offline)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cleaner_profiles
  ADD COLUMN IF NOT EXISTS payout_model text NOT NULL DEFAULT 'percentage_contractor';

ALTER TABLE public.cleaner_profiles DROP CONSTRAINT IF EXISTS cleaner_profiles_payout_model_chk;
ALTER TABLE public.cleaner_profiles ADD  CONSTRAINT cleaner_profiles_payout_model_chk
  CHECK (payout_model IN ('percentage_contractor','hourly_external'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. appointments — selected card + authorization + cancellation state
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS payment_method_id         text,
  ADD COLUMN IF NOT EXISTS authorization_status      text,
  ADD COLUMN IF NOT EXISTS authorize_at              timestamptz,
  ADD COLUMN IF NOT EXISTS reauth_count              integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at              timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason       text,
  ADD COLUMN IF NOT EXISTS cancellation_fee_captured bigint;

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_authorization_status_chk;
ALTER TABLE public.appointments ADD  CONSTRAINT appointments_authorization_status_chk
  CHECK (authorization_status IS NULL OR authorization_status IN
    ('none','scheduled','authorizing','requires_action','authorized','captured','canceled','failed'));

-- drives the just-in-time authorizer cron (decision #13)
CREATE INDEX IF NOT EXISTS appointments_authorize_at_idx
  ON public.appointments (authorize_at) WHERE authorize_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. payments — destination-charge wiring + capture/fee accounting
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_setup_intent_id          text,
  ADD COLUMN IF NOT EXISTS authorized_at                   timestamptz,
  ADD COLUMN IF NOT EXISTS captured_at                     timestamptz,
  ADD COLUMN IF NOT EXISTS on_behalf_of_account_id         text,
  ADD COLUMN IF NOT EXISTS transfer_destination_account_id text,
  ADD COLUMN IF NOT EXISTS transfer_amount                 bigint,
  ADD COLUMN IF NOT EXISTS application_fee_amount          bigint,
  ADD COLUMN IF NOT EXISTS application_fee_bps_snapshot     integer,
  ADD COLUMN IF NOT EXISTS payment_intent_status           text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. payouts — two-leg (tenant→cleaner) audit + tighten organization_id
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS source_balance_account_id text,
  ADD COLUMN IF NOT EXISTS transfer_group            text;

-- backfill organization_id from the linked appointment, then enforce NOT NULL
-- (only if no orphan rows remain — never fail the migration on legacy data)
UPDATE public.payouts p
   SET organization_id = a.organization_id
  FROM public.appointments a
 WHERE p.appointment_id = a.id
   AND p.organization_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payouts WHERE organization_id IS NULL) THEN
    ALTER TABLE public.payouts ALTER COLUMN organization_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'payouts.organization_id left nullable: % orphan row(s) without a derivable org',
      (SELECT count(*) FROM public.payouts WHERE organization_id IS NULL);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. homeowner_payment_links — hosted "send a card link" tokens
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.homeowner_payment_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  homeowner_id    uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  setup_intent_id text,
  status          text NOT NULL DEFAULT 'pending',
  created_by      uuid NOT NULL REFERENCES public.user_profiles(id),
  expires_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT homeowner_payment_links_status_chk
    CHECK (status IN ('pending','completed','expired','revoked'))
);
CREATE INDEX IF NOT EXISTS homeowner_payment_links_token_idx     ON public.homeowner_payment_links (token);
CREATE INDEX IF NOT EXISTS homeowner_payment_links_org_status_idx ON public.homeowner_payment_links (organization_id, status);
CREATE INDEX IF NOT EXISTS homeowner_payment_links_expires_idx    ON public.homeowner_payment_links (expires_at) WHERE status = 'pending';

ALTER TABLE public.homeowner_payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org staff read payment links"   ON public.homeowner_payment_links;
DROP POLICY IF EXISTS "org staff insert payment links" ON public.homeowner_payment_links;
DROP POLICY IF EXISTS "org staff update payment links" ON public.homeowner_payment_links;

CREATE POLICY "org staff read payment links" ON public.homeowner_payment_links
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = homeowner_payment_links.organization_id
       AND om.user_id = auth.uid()
       AND om.role IN ('owner','admin','manager')));
CREATE POLICY "org staff insert payment links" ON public.homeowner_payment_links
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = homeowner_payment_links.organization_id
       AND om.user_id = auth.uid()
       AND om.role IN ('owner','admin','manager')));
CREATE POLICY "org staff update payment links" ON public.homeowner_payment_links
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = homeowner_payment_links.organization_id
       AND om.user_id = auth.uid()
       AND om.role IN ('owner','admin','manager')));

-- realtime: admin appointment modal subscribes to status flips ('pending'→'completed')
ALTER TABLE public.homeowner_payment_links REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename = 'homeowner_payment_links'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.homeowner_payment_links;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. refunds — first-class refund record
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refunds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id),
  payment_id        uuid NOT NULL REFERENCES public.payments(id),
  appointment_id    uuid NOT NULL REFERENCES public.appointments(id),
  stripe_refund_id  text NOT NULL UNIQUE,
  amount            bigint NOT NULL,
  reason            text,
  initiator_user_id uuid NOT NULL REFERENCES public.user_profiles(id),
  status            text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_status_chk CHECK (status IN ('pending','succeeded','failed','canceled'))
);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON public.refunds (payment_id);
CREATE INDEX IF NOT EXISTS refunds_org_idx     ON public.refunds (organization_id);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org staff read refunds" ON public.refunds;
CREATE POLICY "org staff read refunds" ON public.refunds
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = refunds.organization_id
       AND om.user_id = auth.uid()
       AND om.role IN ('owner','admin','manager')));

DROP TRIGGER IF EXISTS refunds_set_updated_at ON public.refunds;
CREATE TRIGGER refunds_set_updated_at BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. disputes — chargeback tracking from webhooks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.disputes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id),
  payment_id        uuid REFERENCES public.payments(id),
  stripe_dispute_id text NOT NULL UNIQUE,
  stripe_charge_id  text NOT NULL,
  amount            bigint NOT NULL,
  status            text NOT NULL,
  reason            text,
  evidence_due_by   timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disputes_org_idx     ON public.disputes (organization_id);
CREATE INDEX IF NOT EXISTS disputes_payment_idx ON public.disputes (payment_id);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org staff read disputes" ON public.disputes;
CREATE POLICY "org staff read disputes" ON public.disputes
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = disputes.organization_id
       AND om.user_id = auth.uid()
       AND om.role IN ('owner','admin','manager')));

DROP TRIGGER IF EXISTS disputes_set_updated_at ON public.disputes;
CREATE TRIGGER disputes_set_updated_at BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. application_fees — platform fee ledger (mirror of Stripe ApplicationFee)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.application_fees (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id),
  payment_id                uuid NOT NULL REFERENCES public.payments(id),
  stripe_application_fee_id text NOT NULL UNIQUE,
  amount                    bigint NOT NULL,
  bps_applied               integer NOT NULL,
  refunded_amount           bigint NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_fees_org_idx ON public.application_fees (organization_id);

ALTER TABLE public.application_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org staff read application fees" ON public.application_fees;
CREATE POLICY "org staff read application fees" ON public.application_fees
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = application_fees.organization_id
       AND om.user_id = auth.uid()
       AND om.role IN ('owner','admin','manager')));

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. payment_events — append-only forensic ledger (never updated)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid REFERENCES public.payments(id),
  appointment_id  uuid REFERENCES public.appointments(id),
  organization_id uuid REFERENCES public.organizations(id),
  stripe_event_id text,
  event_type      text NOT NULL,
  prev_status     text,
  new_status      text,
  actor           text,
  amount          bigint,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx     ON public.payment_events (payment_id);
CREATE INDEX IF NOT EXISTS payment_events_appointment_idx ON public.payment_events (appointment_id);
CREATE INDEX IF NOT EXISTS payment_events_created_idx      ON public.payment_events (created_at);

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org staff read payment events" ON public.payment_events;
CREATE POLICY "org staff read payment events" ON public.payment_events
  FOR SELECT TO authenticated USING (
    organization_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.organization_members om
       WHERE om.organization_id = payment_events.organization_id
         AND om.user_id = auth.uid()
         AND om.role IN ('owner','admin','manager')));

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. webhook_events — Stripe event idempotency + dead-letter (internal only)
--     RLS enabled with no policies: only the service role (which bypasses RLS)
--     reads/writes; authenticated clients get nothing.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           text PRIMARY KEY,             -- Stripe event id (evt_...)
  type         text NOT NULL,
  account_id   text,                          -- event.account for Connect events
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status       text NOT NULL DEFAULT 'received',
  error        text,
  CONSTRAINT webhook_events_status_chk CHECK (status IN ('received','processed','failed'))
);
CREATE INDEX IF NOT EXISTS webhook_events_status_idx ON public.webhook_events (status) WHERE status <> 'processed';
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. tenant_subscription_events — SaaS billing webhook audit (Scenario 3)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_subscription_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  stripe_event_id text NOT NULL UNIQUE,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_subscription_events_org_idx ON public.tenant_subscription_events (organization_id);

ALTER TABLE public.tenant_subscription_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org owners read subscription events" ON public.tenant_subscription_events;
CREATE POLICY "org owners read subscription events" ON public.tenant_subscription_events
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.organization_members om
     WHERE om.organization_id = tenant_subscription_events.organization_id
       AND om.user_id = auth.uid()
       AND om.role IN ('owner','admin')));

COMMIT;
