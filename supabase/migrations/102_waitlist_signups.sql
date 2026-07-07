-- Early-access waitlist signups from the marketing landing page (/landing).
-- Written only by the service-role API route (POST /api/waitlist); RLS is
-- enabled with no policies so anon/authenticated clients have no access.

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  company_name text,
  team_size text,
  source text not null default 'landing',
  created_at timestamptz not null default now()
);

-- One signup per email, case-insensitive. The API treats conflicts as
-- success so the endpoint stays idempotent and does not leak membership.
create unique index if not exists waitlist_signups_email_key
  on public.waitlist_signups (lower(email));

alter table public.waitlist_signups enable row level security;
