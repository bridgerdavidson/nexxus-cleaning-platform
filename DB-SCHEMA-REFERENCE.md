# 📋 Nexxus Cleaning Platform - Database Schema Reference

**Last Updated:** November 11, 2025  
**Source of Truth:** This document reflects the **actual production database schema**.

---

## 🔍 Overview

This document serves as the **definitive reference** for all database tables, columns, and types. All TypeScript interfaces and queries **must match** this schema exactly.

---

## 📊 Tables

### `user_profiles`

Extends Supabase `auth.users` with additional profile information.

| Column       | Type          | Nullable | Default       | Description                               |
| ------------ | ------------- | -------- | ------------- | ----------------------------------------- |
| `id`         | `uuid`        | NO       | -             | References `auth.users(id)` (Primary Key) |
| `email`      | `text`        | NO       | -             | User's email address                      |
| `first_name` | `text`        | YES      | -             | First name                                |
| `last_name`  | `text`        | YES      | -             | Last name                                 |
| `phone`      | `text`        | YES      | -             | Phone number                              |
| `role`       | `user_role`   | NO       | `'homeowner'` | User role enum                            |
| `avatar_url` | `text`        | YES      | -             | Profile picture URL                       |
| `created_at` | `timestamptz` | YES      | `now()`       | Creation timestamp                        |
| `updated_at` | `timestamptz` | YES      | `now()`       | Last update timestamp                     |

---

### `cleaner_profiles`

Additional information for users with `role = 'cleaner'`.

| Column                      | Type           | Nullable | Default | Description                                  |
| --------------------------- | -------------- | -------- | ------- | -------------------------------------------- |
| `id`                        | `uuid`         | NO       | -       | References `user_profiles(id)` (Primary Key) |
| `bio`                       | `text`         | YES      | -       | Cleaner bio/description                      |
| `experience_years`          | `integer`      | YES      | -       | Years of cleaning experience                 |
| `hourly_rate`               | `numeric`      | YES      | -       | Hourly rate in USD                           |
| `rating`                    | `numeric(3,2)` | YES      | `0.00`  | Average rating (0.00-5.00)                   |
| `total_jobs`                | `integer`      | YES      | `0`     | Total completed jobs                         |
| `is_available`              | `boolean`      | YES      | `true`  | Availability status                          |
| `background_check_verified` | `boolean`      | YES      | `false` | Background check status                      |
| `insurance_verified`        | `boolean`      | YES      | `false` | Insurance verification status                |
| `created_at`                | `timestamptz`  | YES      | `now()` | Creation timestamp                           |
| `updated_at`                | `timestamptz`  | YES      | `now()` | Last update timestamp                        |

---

### `properties`

Homeowner properties/addresses.

| Column                 | Type          | Nullable | Default              | Description                    |
| ---------------------- | ------------- | -------- | -------------------- | ------------------------------ |
| `id`                   | `uuid`        | NO       | `uuid_generate_v4()` | Primary Key                    |
| `owner_id`             | `uuid`        | NO       | -                    | References `user_profiles(id)` |
| `name`                 | `text`        | NO       | -                    | Property name/nickname         |
| `address`              | `text`        | NO       | -                    | Street address                 |
| `city`                 | `text`        | NO       | -                    | City                           |
| `state`                | `text`        | NO       | -                    | State                          |
| `zip_code`             | `text`        | NO       | -                    | ZIP code                       |
| `bedrooms`             | `integer`     | YES      | -                    | Number of bedrooms             |
| `bathrooms`            | `integer`     | YES      | -                    | Number of bathrooms            |
| `square_feet`          | `integer`     | YES      | -                    | Square footage                 |
| `special_instructions` | `text`        | YES      | -                    | Special cleaning instructions  |
| `access_instructions`  | `text`        | YES      | -                    | Access/entry instructions      |
| `created_at`           | `timestamptz` | YES      | `now()`              | Creation timestamp             |
| `updated_at`           | `timestamptz` | YES      | `now()`              | Last update timestamp          |

---

### `service_types`

Available cleaning service types.

| Column             | Type            | Nullable | Default              | Description                             |
| ------------------ | --------------- | -------- | -------------------- | --------------------------------------- |
| `id`               | `uuid`          | NO       | `uuid_generate_v4()` | Primary Key                             |
| `name`             | `text`          | NO       | -                    | Service name (e.g., "Regular Cleaning") |
| `description`      | `text`          | YES      | -                    | Service description                     |
| `base_price`       | `numeric(10,2)` | NO       | -                    | Base price in USD                       |
| `duration_minutes` | `integer`       | NO       | -                    | **Estimated duration in minutes**       |
| `service_type`     | `service_type`  | NO       | -                    | Service type enum                       |
| `is_active`        | `boolean`       | YES      | `true`               | Active status                           |
| `created_at`       | `timestamptz`   | YES      | `now()`              | Creation timestamp                      |

---

### `appointments`

Cleaning appointments/bookings.

| Column             | Type                 | Nullable | Default              | Description                         |
| ------------------ | -------------------- | -------- | -------------------- | ----------------------------------- |
| `id`               | `uuid`               | NO       | `uuid_generate_v4()` | Primary Key                         |
| `homeowner_id`     | `uuid`               | NO       | -                    | References `user_profiles(id)`      |
| `cleaner_id`       | `uuid`               | YES      | -                    | References `cleaner_profiles(id)`   |
| `property_id`      | `uuid`               | NO       | -                    | References `properties(id)`         |
| `service_type_id`  | `uuid`               | NO       | -                    | References `service_types(id)`      |
| `scheduled_date`   | `date`               | NO       | -                    | Appointment date                    |
| `scheduled_time`   | `time`               | NO       | -                    | Appointment time                    |
| `duration_minutes` | `integer`            | NO       | -                    | Actual duration in minutes          |
| `status`           | `appointment_status` | YES      | `'pending'`          | Status enum                         |
| `total_price`      | `numeric(10,2)`      | NO       | -                    | Total price in USD                  |
| `special_requests` | `text`               | YES      | -                    | **Special requests from homeowner** |
| `notes`            | `text`               | YES      | -                    | **General notes**                   |
| `created_at`       | `timestamptz`        | YES      | `now()`              | Creation timestamp                  |
| `updated_at`       | `timestamptz`        | YES      | `now()`              | Last update timestamp               |

**⚠️ IMPORTANT:**

- Use `special_requests` (NOT `special_instructions`)
- Use `notes` for general appointment notes

---

### `payments`

Payment records for appointments.

| Column                     | Type             | Nullable | Default              | Description                   |
| -------------------------- | ---------------- | -------- | -------------------- | ----------------------------- |
| `id`                       | `uuid`           | NO       | `uuid_generate_v4()` | Primary Key                   |
| `appointment_id`           | `uuid`           | NO       | -                    | References `appointments(id)` |
| `amount`                   | `numeric(10,2)`  | NO       | -                    | Payment amount in USD         |
| `status`                   | `payment_status` | YES      | `'pending'`          | Payment status enum           |
| `stripe_payment_intent_id` | `text`           | YES      | -                    | Stripe payment ID             |
| `paid_at`                  | `timestamptz`    | YES      | -                    | Payment completion timestamp  |
| `created_at`               | `timestamptz`    | YES      | `now()`              | Creation timestamp            |

---

### `messages`

Messages between users (homeowners, cleaners, admins).

| Column           | Type          | Nullable | Default              | Description                              |
| ---------------- | ------------- | -------- | -------------------- | ---------------------------------------- |
| `id`             | `uuid`        | NO       | `uuid_generate_v4()` | Primary Key                              |
| `sender_id`      | `uuid`        | NO       | -                    | References `user_profiles(id)`           |
| `recipient_id`   | `uuid`        | NO       | -                    | References `user_profiles(id)`           |
| `appointment_id` | `uuid`        | YES      | -                    | References `appointments(id)` (optional) |
| `subject`        | `text`        | YES      | -                    | Message subject                          |
| `content`        | `text`        | NO       | -                    | Message content                          |
| `is_read`        | `boolean`     | YES      | `false`              | Read status                              |
| `created_at`     | `timestamptz` | YES      | `now()`              | Creation timestamp                       |

---

### `reviews`

Reviews/ratings for completed appointments.

| Column           | Type          | Nullable | Default              | Description                                       |
| ---------------- | ------------- | -------- | -------------------- | ------------------------------------------------- |
| `id`             | `uuid`        | NO       | `uuid_generate_v4()` | Primary Key                                       |
| `appointment_id` | `uuid`        | NO       | -                    | References `appointments(id)`                     |
| `reviewer_id`    | `uuid`        | NO       | -                    | References `user_profiles(id)` (who wrote review) |
| `reviewee_id`    | `uuid`        | NO       | -                    | References `user_profiles(id)` (who is reviewed)  |
| `rating`         | `integer`     | NO       | -                    | Rating (1-5)                                      |
| `comment`        | `text`        | YES      | -                    | Review comment                                    |
| `created_at`     | `timestamptz` | YES      | `now()`              | Creation timestamp                                |

---

## 🎨 Custom ENUM Types

### `user_role`

```sql
'homeowner' | 'cleaner' | 'admin'
```

### `appointment_status`

```sql
'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
```

### `service_type`

```sql
'regular' | 'deep' | 'move_out' | 'custom'
```

### `payment_status`

```sql
'pending' | 'paid' | 'failed' | 'refunded'
```

---

## 🔗 Key Relationships

```
user_profiles (1) ─── (many) properties
user_profiles (1) ─── (1) cleaner_profiles
user_profiles (1) ─── (many) appointments [as homeowner]
cleaner_profiles (1) ─── (many) appointments [as cleaner]
properties (1) ─── (many) appointments
service_types (1) ─── (many) appointments
appointments (1) ─── (1) payments
appointments (1) ─── (many) messages
appointments (1) ─── (many) reviews
user_profiles (1) ─── (many) messages [as sender]
user_profiles (1) ─── (many) messages [as recipient]
user_profiles (1) ─── (many) reviews [as reviewer]
user_profiles (1) ─── (many) reviews [as reviewee]
```

---

## ✅ Schema Verification Checklist

When writing queries or TypeScript interfaces:

- [ ] Column names match **exactly** (snake_case in DB)
- [ ] Use `duration_minutes` NOT `estimated_duration`
- [ ] Use `special_requests` NOT `special_instructions` (in appointments)
- [ ] Use `cleaner_profiles.id` (NOT `user_id`)
- [ ] Remember `cleaner_profiles.id` IS `user_profiles.id` (no separate foreign key)
- [ ] Use proper ENUM values
- [ ] Handle nullable fields correctly

---

## 🚨 Common Mistakes to Avoid

| ❌ WRONG                            | ✅ CORRECT                         |
| ----------------------------------- | ---------------------------------- |
| `estimated_duration`                | `duration_minutes`                 |
| `appointments.special_instructions` | `appointments.special_requests`    |
| `cleaner_profiles.user_id`          | `cleaner_profiles.id`              |
| `appointment_status = 'approved'`   | `appointment_status = 'confirmed'` |
| `payment_status = 'completed'`      | `payment_status = 'paid'`          |

---

## 📝 Notes

- **All timestamps** use `timestamptz` (timezone-aware)
- **All currency** uses `numeric(10,2)` (exact decimal)
- **All IDs** use `uuid` (generated by `uuid_generate_v4()`)
- **RLS is enabled** on all tables (see `supabase/schema.sql` for policies)

---

**For TypeScript type generation:**

```bash
# Generate types from Supabase
npx supabase gen types typescript --project-id ivcqusxdjprurhhrgpot > src/types/database.types.ts
```

---

_This document is the single source of truth for schema. Update it whenever schema changes are made._
