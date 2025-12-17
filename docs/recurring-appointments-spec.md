# Task: Implement Recurring Appointments (Series + Generated Occurrences)

You are an AI code assistant working in Cursor. Your job is to update this **Next.js + Supabase** project to support **recurring appointments** in a clean, scalable way.

The goal is:

- Users can choose a recurrence option when creating an appointment.
- The system will create a **recurring series** record and **generate individual appointment rows** from that series.
- The UI and API should treat generated appointments mostly like normal one‑off appointments.
- We avoid “infinite” recurrence and cap how far ahead we generate.

---

## 1. Understand the existing appointments implementation

First, scan the codebase and identify:

1. The **appointments table** schema (already exists in Supabase / Postgres):
   - Look for migrations, `schema.sql`, or Supabase migrations in:
     - `supabase/migrations`
     - `db/migrations`
     - or similar.
   - Confirm columns such as:
     - `id`
     - `homeowner_id`
     - `cleaner_id`
     - `property_id`
     - `service_type_id`
     - `scheduled_date`
     - `scheduled_time`
     - `duration_minutes`
     - `status`
     - `organization_id`
     - `created_at`, `updated_at`

2. The **API / server** paths used for appointments, e.g.:
   - A route for creating appointments:
     - `app/api/appointments/route.ts` or
     - `app/api/appointments/[id]/route.ts` or
     - server actions / trpc / RPC functions.
   - A route for listing appointments for an org, property, or cleaner.

3. The **front‑end UI** where the user currently creates and views appointments:
   - Components like `AppointmentForm`, `AppointmentModal`, `CreateAppointmentDialog`, etc.
   - Pages like:
     - `app/appointments/page.tsx`
     - `app/dashboard/appointments.tsx`
   - Identify where form fields for `scheduled_date`, `scheduled_time`, `duration_minutes`, etc. live.

You will integrate recurring logic with this existing surgery, not replace it.

---

## 2. Add a “Recurring Series” table in the database

We will model recurring appointments using a **series + occurrences** approach:

- `recurring_appointment_series` — defines the recurrence pattern and base details.
- `appointments` — keeps the actual, concrete future visits, each optionally linked to a series.

### 2.1. Create `recurring_appointment_series` table

Add a new migration in the Supabase / database migrations folder. Use the existing style and naming pattern (e.g. `YYYYMMDDHHMM_add_recurring_appointment_series.sql`). The migration should create the following table:

```sql
create table public.recurring_appointment_series (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,
  homeowner_id uuid not null references public.homeowners(id) on delete cascade,
  cleaner_id uuid references public.cleaners(id) on delete set null,
  property_id uuid not null references public.properties(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete restrict,

  -- Base appointment info
  start_date date not null,
  start_time time not null,
  duration_minutes int not null check (duration_minutes > 0),

  -- Recurrence pattern
  recurrence_type text not null check (recurrence_type in ('daily', 'weekly', 'monthly')),
  interval int not null default 1 check (interval > 0),           -- every N days/weeks/months
  days_of_week int[] null,                                        -- for weekly patterns; 0=Sunday..6=Saturday

  -- End conditions
  end_date date null,
  max_occurrences int null check (max_occurrences > 0),

  -- Housekeeping
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

If the project already uses a different naming style (e.g. `recurrence_interval`, `repeat_type`), adjust names to stay consistent, but keep the same semantics.

### 2.2. Add `series_id` to `appointments`

Update the existing `appointments` table with a new nullable column to link generated appointments to their series:

```sql
alter table public.appointments
  add column series_id uuid references public.recurring_appointment_series(id) on delete set null;
```

This allows each appointment instance to know which recurring series it belongs to, while still letting one‑off appointments have `series_id` = null.

> Also ensure RLS policies (Row Level Security) allow users to access series and appointments only within their `organization_id`, matching the existing RLS patterns for appointments and organizations. Update or add RLS policies for `recurring_appointment_series` in the same way they exist for `appointments` and `organizations`.

---

## 3. Represent recurrence options on the frontend

In the **appointment creation UI**, add fields for recurrence. Extend the form used to create an appointment, keeping design consistent with current UI kit (Tailwind, shadcn/ui, etc.).

Add form fields like:

- **Recurrence** (select):
  - Does not repeat
  - Daily
  - Weekly
  - Monthly
- **Repeat every** (number input):
  - e.g. `1` (every week), `2` (every 2 weeks)
- **Ends** (radio + conditional input):
  - `On date: [date picker]`
  - `After [N] occurrences`
  - (Optional) `Never` — if used, we will still internally cap generation to a maximum horizon.

Example TypeScript type for the form values (adapt to existing form types):

```ts
type RecurrenceType = "none" | "daily" | "weekly" | "monthly";

interface RecurrenceFormValues {
  recurrenceType: RecurrenceType;
  interval: number;               // 1, 2, etc.
  daysOfWeek?: number[];          // for weekly, 0-6 for Sun-Sat
  endDate?: string | null;        // ISO date
  maxOccurrences?: number | null; // optional
}
```

Integrate these into the existing appointment form component. When `recurrenceType === "none"`, keep existing behavior (create a single appointment). When a recurrence is chosen, call a new endpoint / server action that understands how to create series + multiple appointments.

---

## 4. Create server logic to create recurring series + generated appointments

Create a dedicated server function for handling new recurring appointments. Use whatever pattern the project currently uses for server logic:

- Next.js route handler in `app/api/recurring-appointments/route.ts`
- Or a shared server function (e.g., in `lib/appointments/recurring.ts`) used by route handlers or server actions.

Assume a payload like:

```ts
interface CreateRecurringAppointmentInput {
  organizationId: string;
  homeownerId: string;
  cleanerId?: string | null;
  propertyId: string;
  serviceTypeId: string;

  startDate: string;         // ISO date
  startTime: string;         // e.g. "09:00"
  durationMinutes: number;

  recurrenceType: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek?: number[];     // required for weekly, optional otherwise
  endDate?: string | null;
  maxOccurrences?: number | null;
}
```

### 4.1. Decide how far ahead to generate

To avoid creating thousands of rows, we will generate **up to a limited horizon**, e.g.:

- At most **6 months** from `startDate`, and/or
- At most **50 occurrences**

You can tune these numbers, but implement a safety cap.

Implement a helper (in a shared server utility, e.g. `lib/appointments/recurrence.ts`) that:

1. Validates the input.
2. Computes a list of `appointments` rows to insert.

Pseudo‑TypeScript:

```ts
import { addDays, addWeeks, addMonths } from "date-fns";

interface Occurrence {
  scheduled_date: string;  // date only
  scheduled_time: string;  // "HH:mm"
  duration_minutes: number;
}

function generateOccurrences(input: {
  startDate: string;
  startTime: string;
  durationMinutes: number;
  recurrenceType: "daily" | "weekly" | "monthly";
  interval: number;
  daysOfWeek?: number[];
  endDate?: string | null;
  maxOccurrences?: number | null;
}): Occurrence[] {
  const {
    startDate,
    startTime,
    durationMinutes,
    recurrenceType,
    interval,
    daysOfWeek,
    endDate,
    maxOccurrences,
  } = input;

  const start = new Date(startDate);
  const hardCapEnd = addMonths(start, 6); // 6-month generation cap

  const userEnd = endDate ? new Date(endDate) : null;
  const cutoffDate = userEnd
    ? (userEnd < hardCapEnd ? userEnd : hardCapEnd)
    : hardCapEnd;

  const occurrences: Occurrence[] = [];
  let count = 0;

  // Daily & monthly patterns are straightforward; weekly may use daysOfWeek
  if (recurrenceType === "daily" || recurrenceType === "monthly") {
    let current = start;

    while (current <= cutoffDate) {
      if (maxOccurrences && count >= maxOccurrences) break;

      occurrences.push({
        scheduled_date: current.toISOString().slice(0, 10),
        scheduled_time: startTime,
        duration_minutes: durationMinutes,
      });

      if (recurrenceType === "daily") {
        current = addDays(current, interval);
      } else {
        current = addMonths(current, interval);
      }
      count++;
    }
  } else if (recurrenceType === "weekly") {
    // Weekly recurrence: if daysOfWeek is provided, generate occurrences on those weekdays
    // over each interval period. If not provided, assume the weekday of startDate.
    const activeDays = (daysOfWeek && daysOfWeek.length > 0)
      ? daysOfWeek
      : [start.getDay()];

    let currentWeekStart = start;

    while (currentWeekStart <= cutoffDate) {
      for (const weekday of activeDays) {
        const current = new Date(currentWeekStart);
        const delta = weekday - current.getDay();
        current.setDate(current.getDate() + delta);

        if (current < start) continue;
        if (current > cutoffDate) continue;
        if (maxOccurrences && count >= maxOccurrences) break;

        occurrences.push({
          scheduled_date: current.toISOString().slice(0, 10),
          scheduled_time: startTime,
          duration_minutes: durationMinutes,
        });
        count++;

        if (maxOccurrences && count >= maxOccurrences) break;
      }

      currentWeekStart = addWeeks(currentWeekStart, interval);
    }
  }

  return occurrences;
}
```

Adapt this to the project’s utility structure, imports, and date handling patterns.

### 4.2. Insert series + appointments in a transaction

In the server logic that handles **creating a recurring appointment**, do the following in one transaction (or as close as possible using Supabase RPC / PostgREST / supabase-js):

1. Insert a row into `recurring_appointment_series` with:
   - Org, homeowner, cleaner, property, service type
   - Base time (start_date, start_time, duration_minutes)
   - Recurrence pattern (recurrence_type, interval, days_of_week, end_date, max_occurrences)

2. Generate occurrences using the helper above.

3. Bulk insert into `appointments` using the generated occurrences, setting:
   - `series_id` = the new series id
   - `scheduled_date`, `scheduled_time`, `duration_minutes`
   - `homeowner_id`, `cleaner_id`, `property_id`, `service_type_id`, `organization_id`
   - `status` = default (e.g., "scheduled")

For example, using `supabase-js` in a server action / route handler (pseudo-code, adapt to project):

```ts
import { createServerClient } from "@/lib/supabaseServer"; // or equivalent

export async function createRecurringAppointment(input: CreateRecurringAppointmentInput) {
  const supabase = createServerClient();

  // 1. Insert series
  const { data: series, error: seriesError } = await supabase
    .from("recurring_appointment_series")
    .insert({
      organization_id: input.organizationId,
      homeowner_id: input.homeownerId,
      cleaner_id: input.cleanerId ?? null,
      property_id: input.propertyId,
      service_type_id: input.serviceTypeId,
      start_date: input.startDate,
      start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      recurrence_type: input.recurrenceType,
      interval: input.interval,
      days_of_week: input.daysOfWeek ?? null,
      end_date: input.endDate ?? null,
      max_occurrences: input.maxOccurrences ?? null,
    })
    .select()
    .single();

  if (seriesError || !series) {
    throw seriesError ?? new Error("Failed to create recurring series");
  }

  // 2. Generate occurrences
  const occurrences = generateOccurrences({
    startDate: input.startDate,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    recurrenceType: input.recurrenceType,
    interval: input.interval,
    daysOfWeek: input.daysOfWeek,
    endDate: input.endDate ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
  });

  if (occurrences.length === 0) {
    // Optional: consider deleting the series if no occurrences generated
    return { series, appointments: [] };
  }

  // 3. Insert appointments in bulk
  const appointmentRows = occurrences.map((occ) => ({
    organization_id: input.organizationId,
    homeowner_id: input.homeownerId,
    cleaner_id: input.cleanerId ?? null,
    property_id: input.propertyId,
    service_type_id: input.serviceTypeId,
    scheduled_date: occ.scheduled_date,
    scheduled_time: occ.scheduled_time,
    duration_minutes: occ.duration_minutes,
    status: "scheduled",
    series_id: series.id,
  }));

  const { data: appointments, error: appointmentsError } = await supabase
    .from("appointments")
    .insert(appointmentRows)
    .select();

  if (appointmentsError) {
    throw appointmentsError;
  }

  return { series, appointments };
}
```

Adapt:
- The actual Supabase client helper
- Column names (`status`, `organization_id`) to match current schema
- Error handling to the project’s patterns

---

## 5. Wire the frontend form to the new recurring logic

In the **appointment creation UI**:

- Keep the existing “one‑off appointment” flow.
- When the user selects `Recurrence = Does not repeat`, submit to the existing endpoint or server action.
- When the user selects `Recurrence != none`, submit to a new handler that calls `createRecurringAppointment` (or the new API route you created).

### Example (pseudo-code, React client component)

```tsx
async function handleSubmit(values: AppointmentFormValues) {
  // Extract recurrence-related fields
  const recurrenceType = values.recurrenceType; // "none" | "daily" | "weekly" | "monthly"

  if (recurrenceType === "none") {
    // Existing behavior: create a single appointment
    await createSingleAppointment(values);
    return;
  }

  // Recurring logic
  await createRecurringAppointment({
    organizationId: values.organizationId,
    homeownerId: values.homeownerId,
    cleanerId: values.cleanerId,
    propertyId: values.propertyId,
    serviceTypeId: values.serviceTypeId,
    startDate: values.scheduledDate,
    startTime: values.scheduledTime,
    durationMinutes: values.durationMinutes,
    recurrenceType: recurrenceType,
    interval: values.interval ?? 1,
    daysOfWeek: values.daysOfWeek,
    endDate: values.endDate,
    maxOccurrences: values.maxOccurrences,
  });
}
```

Ensure the UI shows a clear confirmation that multiple appointments were created and that they appear in the existing lists / calendars like normal appointments.

---

## 6. Ensure recurring appointments appear in lists and calendars

The existing appointment listing logic likely already selects from the `appointments` table with filters such as:

- By organization
- By homeowner
- By date range
- By cleaner

Because recurring appointments are **just more appointments** with a `series_id`, existing queries should naturally pick them up. However:

- Make sure the new `series_id` column is **selected** and typed in any TS types / Zod schemas representing `Appointment`.
- Optionally, show recurrence info in the UI (e.g., a small icon or tooltip), but this is not required for the core functionality.

---

## 7. RLS and security considerations

Update or add RLS policies so that:

- `recurring_appointment_series` rows are only visible to users who can see their `organization_id`, mirroring `appointments` RLS.
- Insert/update/delete on `recurring_appointment_series` is restricted to authorized users (e.g., org admins) in the same way appointment CRUD is restricted.

Check any existing policies in the project for `appointments`, `organizations`, and related tables, and copy/adjust them to `recurring_appointment_series` for consistency.

---

## 8. Optional: future cron / scheduled generation

For now, we only generate occurrences out to a fixed horizon (e.g., 6 months or N appointments). In the future, the project may want to:

- Run a scheduled job (e.g., via Supabase cron / Edge Function) that:
  - Looks at active series.
  - Extends their generated appointments when they are running low (e.g., always maintain at least 2–3 months ahead).

You don’t need to implement this now, but the **series + occurrences** design you implement must be compatible with that future extension.

---

## 9. Testing checklist

Before finishing, ensure all of the following work:

1. **Create a one‑off appointment**:
   - Form with recurrence set to “Does not repeat” behaves exactly as before.
   - Only one appointment row is created.

2. **Create a recurring weekly appointment** (e.g., every Monday at 9:00 AM):
   - Recurrence: weekly, interval 1, end date or max occurrences set.
   - A row is created in `recurring_appointment_series`.
   - Multiple appointment rows are created in `appointments`, all with `series_id` set to the series’ id.
   - They appear in the existing appointment lists / calendar views.

3. **Boundary behavior**:
   - If user chooses an end date far in the future, appointments are still capped by the horizon (e.g., 6 months / 50 occurrences).
   - If user chooses maxOccurrences = 3, only three appointments are created, even if the endDate/horizon allows more.

4. **RLS / permissions**:
   - A user from another organization cannot read or modify a series or its appointments outside their org.
   - Admin‑level users can manage series and appointments for their own org.

5. **Code quality**:
   - Types, imports, and file structure follow existing patterns.
   - No unused helpers or dead code is introduced.
   - Any new files (e.g., `lib/appointments/recurrence.ts`) are placed logically according to the current project structure.

---

## 10. Summary of what you (Cursor) should implement

- [ ] Find the existing appointments schema, API, and UI components.
- [ ] Add a `recurring_appointment_series` table via a migration, with appropriate RLS.
- [ ] Add a nullable `series_id` column to `appointments` and update TS types/schemas for appointments.
- [ ] Create a recurrence generation utility that:
  - [ ] Supports `daily`, `weekly`, and `monthly` with an interval and optional `daysOfWeek`.
  - [ ] Accepts an end date and/or max occurrences.
  - [ ] Caps generation to a safe max horizon (e.g., 6 months / 50 occurrences).
- [ ] Implement a server function / route to create a series and generate appointments in one operation.
- [ ] Extend the appointment creation form to include recurrence options.
- [ ] Route recurring submissions through the new server logic.
- [ ] Verify that recurring appointments show up in existing lists / calendars correctly and respect RLS.
