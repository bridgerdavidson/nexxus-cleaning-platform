# Resetting the local Supabase baseline

This repo's `supabase/migrations/` directory starts at `031_*` — migrations 1–30 are not on disk; their effects live only in the `dev` and `prod` Supabase projects. As a result, `npx supabase start` against the existing migration set produces an **incomplete** local schema, and integration tests will fail at table-lookup time.

The fix is a one-time baseline dump. Do this once; the result is checked in as `supabase/migrations/000_baseline.sql` and replaces the old `supabase/schema.sql`.

## Prerequisites

- Docker Desktop running (Supabase CLI uses it to spin up a temporary container for the dump).
- You're logged in: `npx supabase login` (uses a personal access token from <https://supabase.com/dashboard/account/tokens>).
- The repo is linked to a project — `supabase/.temp/project-ref` shows which. Currently linked to **prod** (`ivcqusxdjprurhhrgpot` / `cleaning-solutions-prod`). The dump target is whichever project is linked.

## One-time procedure

```bash
# 1. Capture the current canonical schema from the linked remote project.
npx supabase db dump --linked --schema public -f supabase/migrations/000_baseline.sql

# 2. Remove the now-stale legacy file.
rm supabase/schema.sql

# 3. Move the granular migrations out of the way — they're already baked into 000_baseline,
#    so re-applying them on top of a fresh local DB would produce "table already exists" errors.
mkdir -p supabase/migrations-archive
git mv supabase/migrations/0[3-5][0-9]_*.sql supabase/migrations-archive/

# 4. Verify locally: a fresh reset should produce the canonical schema with no errors.
npx supabase db reset

# 5. Tell the remote projects that 000_baseline is *already applied* (it captures their
#    current state — re-running it on the remote would fail). Repeat for each project.
#
#    For dev:
npx supabase link --project-ref suaezjtspglgulunkyip
npx supabase migration repair --status applied 000

#    For prod (currently linked):
npx supabase link --project-ref ivcqusxdjprurhhrgpot
npx supabase migration repair --status applied 000
```

## What `supabase db push` will do after this

- On a fresh project: applies `000_baseline.sql` plus any new migrations added going forward.
- On the existing dev/prod projects: skips `000_baseline` (because step 5 marked it applied), applies only new migrations 057+ as they're added.

## After the baseline is in place

Integration tests will work locally and in CI. CI handles env capture itself (`.github/workflows/ci.yml`). For local runs:

### macOS / Linux (bash)

```bash
npx supabase start
npx supabase status --output json | jq -r '
  "NEXT_PUBLIC_SUPABASE_URL=" + .API_URL,
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=" + .ANON_KEY,
  "SUPABASE_SERVICE_ROLE_KEY=" + .SERVICE_ROLE_KEY
' > .env.test.local
{
  echo "STRIPE_ENABLED=true"
  echo "NEXT_PUBLIC_STRIPE_ENABLED=true"
  echo "STRIPE_SECRET_KEY=sk_test_fake"
  echo "STRIPE_WEBHOOK_SECRET=whsec_fake"
} >> .env.test.local
npm run test:integration
```

### Windows (PowerShell)

`jq` isn't standard on Windows, and `/tmp` doesn't exist — use `ConvertFrom-Json` + `[System.IO.File]::WriteAllLines` (which writes UTF-8 without BOM):

```powershell
npx supabase start
$status = npx supabase status --output json | ConvertFrom-Json
$lines = @(
  "NEXT_PUBLIC_SUPABASE_URL=$($status.API_URL)",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=$($status.ANON_KEY)",
  "SUPABASE_SERVICE_ROLE_KEY=$($status.SERVICE_ROLE_KEY)",
  "STRIPE_ENABLED=true",
  "NEXT_PUBLIC_STRIPE_ENABLED=true",
  "STRIPE_SECRET_KEY=sk_test_fake",
  "STRIPE_WEBHOOK_SECRET=whsec_fake"
)
[System.IO.File]::WriteAllLines("$PWD\.env.test.local", $lines)
npm run test:integration
```

(The integration test loader strips UTF-8 BOM if your shell happens to add one, but BOM-free is cleaner.)

## Seeding the platform admin (migration 068)

`068_platform_admins.sql` seeds the founding platform admin by email (`mvbdavidson@gmail.com`). The `INSERT ... SELECT ... WHERE email = ...` inserts **zero rows** (no error) if that auth user doesn't exist in the target environment at migrate time — e.g. on a brand-new prod project where the account hasn't been created yet.

If the seed didn't take (you log in and don't land on `/owner`), create the account first, then run once against the linked project:

```sql
INSERT INTO public.platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'mvbdavidson@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
```

To grant additional platform admins later, insert their `auth.users.id` the same way (optionally set `granted_by`).
