-- Migration: 041_invite_reinvite_flow.sql
-- Extends inv_status enum with transitional values needed for the reinvite
-- state machine (creating → pending, or failed/superseded on error/resend).
-- Also ensures the invites table exists with all required indexes and trigger.

-- ── 1. Extend inv_status enum ───────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so each
-- ADD VALUE is guarded by its own idempotent DO block.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'inv_status'
  ) THEN
    RAISE EXCEPTION 'Type inv_status does not exist. Ensure base schema is applied first.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'inv_status' AND e.enumlabel = 'creating'
  ) THEN
    ALTER TYPE inv_status ADD VALUE 'creating';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'inv_status' AND e.enumlabel = 'superseded'
  ) THEN
    ALTER TYPE inv_status ADD VALUE 'superseded';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'inv_status' AND e.enumlabel = 'failed'
  ) THEN
    ALTER TYPE inv_status ADD VALUE 'failed';
  END IF;
END $$;

-- ── 2. Create invites table if it does not exist ────────────────────────────

CREATE TABLE IF NOT EXISTS public.invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  email text NOT NULL,
  role public.org_role NOT NULL,
  status public.inv_status NOT NULL DEFAULT 'pending'::inv_status,
  sent_at timestamp with time zone NULL DEFAULT now(),
  accepted_at timestamp with time zone NULL,
  invited_by uuid NOT NULL,
  expiration_date timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invites_pkey PRIMARY KEY (id),
  CONSTRAINT invites_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES user_profiles (id) ON DELETE CASCADE,
  CONSTRAINT invites_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT invites_accepted_requires_timestamp CHECK (
    (status <> 'accepted'::inv_status) OR (accepted_at IS NOT NULL)
  ),
  CONSTRAINT invites_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT invites_email_not_blank CHECK (length(trim(both from email)) > 0)
) TABLESPACE pg_default;

-- ── 3. Indexes (all idempotent) ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invites_organization_id
  ON public.invites USING btree (organization_id) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_invites_email
  ON public.invites USING btree (email) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_invites_status
  ON public.invites USING btree (status) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_invites_org_email_status
  ON public.invites USING btree (organization_id, email, status) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_invites_invited_by
  ON public.invites USING btree (invited_by) TABLESPACE pg_default;

-- One pending invite per org+email enforced at DB level.
-- 'creating', 'superseded', 'failed' rows are exempt from this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_one_pending_per_org_email
  ON public.invites USING btree (organization_id, email)
  TABLESPACE pg_default
  WHERE (status = 'pending'::inv_status);

-- ── 4. updated_at trigger (idempotent) ──────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_invites_updated_at'
  ) THEN
    CREATE TRIGGER update_invites_updated_at
      BEFORE UPDATE ON public.invites
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
