# Organizations & Multi-Tenancy Migration

> **Goal:** Refactor Nexxus Cleaning Solutions from a single-tenant-style app to a multi-tenant app where each **organization (business)** only sees its own data (cleaners, properties, appointments, etc.).

This document explains:

- The **database changes** that were applied
- The **required code changes** so queries and inserts are organization-aware
- Concrete **search targets** to help the Cursor agent find the right places to update

---

## 1. Database Changes

### 1.1 New enum: `org_role`

A new enum was added for **per-organization roles**, which is separate from `user_profiles.role`:

```sql
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'manager', 'cleaner', 'homeowner');
```

- `user_profiles.role` (existing) = global/default persona for the user (used for signup / simple UI logic).
- `organization_members.role` (new) = the user’s role **inside a specific organization** (source of truth for permissions per org).

---

### 1.2 New table: `organizations`

Each business that uses Nexxus is represented by an `organizations` row.

```sql
CREATE TABLE public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  logo_url    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.user_profiles(id)
);
```

Key notes:

- `id` is the **tenant key**.
- `created_by` points to the `user_profiles.id` of the user that created the organization.
- A **“Default Organization”** was created and all existing data was tagged with its `id` during the migration.

---

### 1.3 New table: `organization_members`

This table connects users to organizations and stores their role within that organization.

```sql
CREATE TABLE public.organization_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role            org_role NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
```

Notes:

- A user can belong to multiple organizations (if desired) by having multiple rows.
- `UNIQUE (organization_id, user_id)` currently enforces **one role per user per org**.
- Existing users were inserted into `organization_members` for the Default Organization with a role derived from `user_profiles.role`.

---

### 1.4 New `organization_id` column on domain tables

The following tables were modified to include an `organization_id` column that references `organizations.id`:

```sql
ALTER TABLE public.cleaner_profiles
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.properties
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.appointments
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.messages
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.payments
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.reviews
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

ALTER TABLE public.service_types
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
```

Each row in these tables now belongs to exactly one organization via `organization_id`.

All existing rows were backfilled with the **Default Organization**’s `id`.

Indexes for performance:

```sql
CREATE INDEX ON public.cleaner_profiles (organization_id);
CREATE INDEX ON public.properties      (organization_id);
CREATE INDEX ON public.appointments    (organization_id);
CREATE INDEX ON public.messages        (organization_id);
CREATE INDEX ON public.payments        (organization_id);
CREATE INDEX ON public.reviews         (organization_id);
CREATE INDEX ON public.service_types   (organization_id);
```

> In the future, these `organization_id` columns should be set to `NOT NULL` to guarantee that all new rows are org-scoped.

---

## 2. Code-Level Changes (High-Level)

### 2.1 Core behavior

The codebase must now:

1. Determine the **current organization** for the logged-in user (`currentOrganizationId` + `currentOrgRole`).
2. Store that in global/app state (e.g. via `useAuth`, React context, Zustand, etc.).
3. For org-owned tables (`appointments`, `cleaner_profiles`, `properties`, `messages`, `payments`, `reviews`, `service_types`):
   - Scope **all SELECT queries** with `organization_id = currentOrganizationId`.
   - Include `organization_id: currentOrganizationId` in **all INSERT/UPSERT** operations.
4. Gradually shift permission checks from `user_profiles.role` to `organization_members.role` (exposed as `currentOrgRole`).

---

## 3. Auth / Context Updates

### 3.1 Add organization info to the auth context

**Goal:** When a user is logged in, we should be able to access:

- `currentOrganizationId: string | null`
- `currentOrgRole: 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner' | null`
- (Optionally) `currentOrganization` object: `{ id, name, logo_url? }`

#### 3.1.1 Locate the auth provider / hook

**Search targets (for Cursor):**

- `useAuth(`
- `AuthProvider`
- `AuthContext`

Once located, extend this context with organization data.

#### 3.1.2 Load memberships after user login

Inside the auth provider, where user/session is loaded:

```ts
const [currentOrganizationId, setCurrentOrganizationId] = useState<
  string | null
>(null);
const [currentOrgRole, setCurrentOrgRole] = useState<org_role | null>(null);
const [currentOrganization, setCurrentOrganization] = useState<{
  id: string;
  name: string;
  logo_url?: string;
} | null>(null);
```

Then, when `user` is available:

```ts
useEffect(() => {
  if (!user) {
    setCurrentOrganizationId(null);
    setCurrentOrgRole(null);
    setCurrentOrganization(null);
    return;
  }

  const loadOrganization = async () => {
    const { data, error } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations ( name, logo_url )")
      .eq("user_id", user.id);

    if (error || !data || data.length === 0) {
      setCurrentOrganizationId(null);
      setCurrentOrgRole(null);
      setCurrentOrganization(null);
      return;
    }

    const membership = data[0]; // For now, pick the first org
    setCurrentOrganizationId(membership.organization_id);
    setCurrentOrgRole(membership.role);
    setCurrentOrganization({
      id: membership.organization_id,
      name: membership.organizations?.name ?? "Organization",
      logo_url: membership.organizations?.logo_url ?? undefined,
    });
  };

  loadOrganization();
}, [user]);
```

Finally, expose these in the auth context:

```ts
const value = {
  user,
  session,
  signIn,
  signOut,
  // existing fields...
  currentOrganizationId,
  currentOrgRole,
  currentOrganization,
};

return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
```

**Search target for Cursor to update**: the `value` passed to `AuthContext.Provider` and the `useAuth` return type.

---

## 4. Updating Queries to Use `organization_id`

The following tables are **tenant-scoped** and must always be filtered or inserted with `organization_id`:

- `appointments`
- `cleaner_profiles`
- `properties`
- `messages`
- `payments`
- `reviews`
- `service_types`

### 4.1 SELECT queries

**Search targets (for Cursor):**

- `from('appointments')`
- `from("appointments")`
- `from('cleaner_profiles')`
- `from('properties')`
- `from('messages')`
- `from('payments')`
- `from('reviews')`
- `from('service_types')`

For each SELECT, ensure `organization_id` is used.

**Before:**

```ts
const { data: appointments } = await supabase.from("appointments").select("*");
```

**After:**

```ts
const { currentOrganizationId } = useAuth();

const { data: appointments } = await supabase
  .from("appointments")
  .select("*")
  .eq("organization_id", currentOrganizationId);
```

If a SELECT already has other filters, just add the `.eq('organization_id', currentOrganizationId)` alongside them.

Apply the same pattern to `cleaner_profiles`, `properties`, `messages`, `payments`, `reviews`, and `service_types`.

---

### 4.2 INSERT / UPSERT queries

**Search targets (for Cursor):**

- `.from('appointments').insert(`
- `.from("appointments").insert(`
- `.from('cleaner_profiles').insert(`
- `.from('properties').insert(`
- `.from('messages').insert(`
- `.from('payments').insert(`
- `.from('reviews').insert(`
- `.from('service_types').insert(`
- And similar patterns with `.upsert(` for these tables.

For each insert/upsert, include `organization_id`.

**Before (example – creating an appointment):**

```ts
const { error } = await supabase.from("appointments").insert({
  homeowner_id,
  cleaner_id,
  property_id,
  service_type_id,
  scheduled_date,
  scheduled_time,
  duration_minutes,
  status,
  total_price,
  special_requests,
  notes,
});
```

**After:**

```ts
const { currentOrganizationId } = useAuth();

const { error } = await supabase.from("appointments").insert({
  organization_id: currentOrganizationId, // NEW
  homeowner_id,
  cleaner_id,
  property_id,
  service_type_id,
  scheduled_date,
  scheduled_time,
  duration_minutes,
  status,
  total_price,
  special_requests,
  notes,
});
```

Apply this pattern to inserts/updates for:

- `appointments`
- `cleaner_profiles`
- `properties`
- `messages`
- `payments`
- `reviews`
- `service_types`

If there are helper functions like `createAppointment`, `createCleanerProfile`, etc., they should be updated to accept or read `currentOrganizationId` and always set `organization_id` when inserting.

---

## 5. Roles: From `user_profiles.role` to `organization_members.role`

Current table:

```sql
CREATE TABLE public.user_profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  role user_role NOT NULL DEFAULT 'homeowner'::user_role,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (id) REFERENCES auth.users(id)
);
```

**Search targets (for Cursor):**

- `user_profiles.role`
- `role === 'admin'`
- `role === 'cleaner'`
- `role === 'homeowner'`
- `role === 'manager'`
- `if (user?.role`
- `if (profile?.role`

These are likely used in permission checks and conditional rendering.

### 5.1 Introduce `currentOrgRole`

Rather than changing all existing uses immediately, introduce `currentOrgRole` from the auth context and start using it for per-org permissions.

Example:

```ts
const { currentOrgRole } = useAuth();

const isAdminOrManager =
  currentOrgRole === "owner" ||
  currentOrgRole === "admin" ||
  currentOrgRole === "manager";
```

Where appropriate, replace or supplement checks on `user_profiles.role` with checks against `currentOrgRole`.

> For now, keep `user_profiles.role` usage in place if refactoring everything would be too large; just ensure the new org-based role concept is available for future permission logic.

---

## 6. Optional: Future Multi-Org UI

In the future, users may belong to multiple organizations. To support that:

1. Create a UI element (e.g. in header or settings) to:

   - List all org memberships for the user:
     ```ts
     const { data: memberships } = await supabase
       .from("organization_members")
       .select("organization_id, role, organizations ( name, logo_url )")
       .eq("user_id", user.id);
     ```
   - Allow the user to select which organization is active.

2. When the user selects an org, update `currentOrganizationId` and `currentOrgRole` in the auth context.

Currently, all users are in the **Default Organization**, so you can safely pick `data[0]` as the active membership.

---

## 7. Regenerating Supabase Types (If Used)

If the project relies on generated Supabase TypeScript types, regenerate them so the new tables/columns are reflected:

```bash
supabase gen types typescript --project-id <your-project-ref> > path/to/database.types.ts
```

Update the path to match your repo.

---

## 8. Acceptance Criteria

The migration is considered successful in the codebase when:

1. The auth/context layer exposes:
   - `currentOrganizationId`
   - `currentOrgRole`
   - optionally `currentOrganization`
2. All Supabase queries involving:
   - `appointments`
   - `cleaner_profiles`
   - `properties`
   - `messages`
   - `payments`
   - `reviews`
   - `service_types`  
     are:
   - Scoped via `.eq('organization_id', currentOrganizationId)` on SELECT.
   - Including `organization_id: currentOrganizationId` on INSERT/UPSERT.
3. Existing UX (listing and creating appointments, cleaners, properties, messages, etc.) still works and only shows data for the active organization.
4. Permission checks can begin to use `currentOrgRole` instead of relying solely on `user_profiles.role`.
