# Follow-up: lock down public storage buckets (security audit H5)

**Severity:** High (deferred from the 2026-06-12 security audit — see `docs/security-audit-2026-06-12.md`)

## Problem
All four Supabase Storage buckets are `public: true` (confirmed on prod
`ivcqusxdjprurhhrgpot`):

| bucket | contents | path shape |
|---|---|---|
| `avatars` | user avatars | `users/{userId}/{uuid}.jpg` |
| `job-photos` | before/after job photos of private residences | `appointments/{appointmentId}/{before\|after}/{uuid}.jpg` |
| `property-photos` | property photos | `properties/{propertyId}/{uuid}.jpg` |
| `message-attachments` | message attachments | `{conversationId}/{messageId}/{uuid}` |

A public bucket serves any object by URL with **no access control**, bypassing RLS
entirely. Object paths are UUID-based, so blind enumeration is not practical, but any
URL that leaks (shared, logged, in a referrer header, in an exported DB row) is
permanently world-readable. For job/property photos of private homes this is a real
privacy exposure.

Storage **write** policies are already correctly scoped (migrations 054/079 etc.), and
upload paths use server-generated UUIDs with `upsert: false`, so the write side is fine.
This ticket is about **read** access.

## Why it was deferred
The correct fix touches every place the app renders an image. Doing it halfway (flipping
buckets to private without converting the render paths) breaks all image loading in prod.
It needs its own branch + visual QA, not a drive-by in the audit-remediation PR.

## Plan
1. **Add authenticated, org-scoped SELECT policies** on `storage.objects` for each bucket,
   in a migration, scoped the same way as the existing INSERT policies (e.g. job-photos:
   caller is a party to / staff of the appointment whose id is `split_part(name,'/',2)`).
   Version-control them (storage policies currently live only in the dashboard for some
   buckets).
2. **Flip the buckets to `public: false`** (migration: `update storage.buckets set public=false where id in (...)`).
3. **Replace `getPublicUrl` with short-TTL `createSignedUrl`** at every render site. Grep:
   - `getPublicUrl(` across `src/`
   - `/storage/v1/object/public/`
   Add a `useSignedPhotoUrl(bucket, path)` helper (or a server action that signs a batch)
   so lists don't issue N round-trips. TTL ~1h, regenerate on demand.
4. **E2E**: add a Playwright check that an unauthenticated fetch of a known object path
   returns 400/403, and that an authenticated same-org user can still see the image.

## Acceptance
- Anonymous GET of any object URL (without a signature) → denied.
- Cross-org authenticated user → denied.
- Owning user / same-org staff → image renders via signed URL.
