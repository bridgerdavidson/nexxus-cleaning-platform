# Auth improvements backlog

Captured 2026-07-03 from a 4-angle analysis of the current auth (mechanics + Supabase config, onboarding/email, security posture, social-login feasibility). The user picked **one item to build now** (password floor + breached check, see the auth-screens spec); everything else here is **deferred, liked, and to be built or re-brainstormed later**. Nothing here is scheduled yet.

## Current state (so we don't re-derive it)

Auth is in solid shape after the **2026-06-12 security audit**: ~25 dangerous unauthenticated legacy routes deleted (verified gone: `disable-rls-temporarily`, `set-passwords`, `fix-admin-user`, `cleanup-and-recreate-users`, `create-users-final`, `migrate-db`, `final-fix`), cross-tenant RLS fixed (migration 089, `is_admin_or_manager_in_org`), role ceilings enforced on invites, org-id derived from the verified caller, and the invite flow hardened against Microsoft 365 Safe-Links prefetch (`opened_at`/`form_closed_at` guards + `pagehide` beacon + lazy expiry).

- **Model:** invite-only, multi-tenant (`organization_members`), roles homeowner/cleaner/manager/admin + `platform_admins`. Org owners are platform-provisioned (`POST /api/platform/organizations`); no self-serve org signup.
- **Auth:** `supabase.auth.signInWithPassword`; sessions in localStorage (`persistSession: true`); auto-refresh + rotation; complex `AuthContext` (org load w/ retries, platform-admin whoami cache, audited "View as" impersonation, visibility revalidation).
- **Password:** app-level `validatePassword` = 8+ chars, upper+lower+number+symbol (strong). Supabase config floor is only 6 with no rules (backstop mismatch).
- **Email:** custom SMTP (Brevo) in prod; `isAuthEmailSendFailure()` -> `platform_alerts` on outage (migration 085).

**Cleanup noted:** `AuthContext.signUp` calls `/api/auth/signup`, which **does not exist** and has no UI (dead code from the invite-only hardening). Delete it, or build real homeowner self-signup if ever wanted.

## Deferred ideas (liked, not scheduled)

### 1. Social login (Google) + magic link  , the headline the user is most curious about
Fits invite-only IF gated by org membership. Design:
- **Login:** "Continue with Google" for existing invited users. After Google returns, check `organization_members`; if member -> in, if not -> a clear "you're not part of an organization yet, ask for an invite" screen (never a blank/no-org dashboard).
- **Accept-invite:** "Continue with Google" lets an invited user finish setup with no password (matched to the invited email; set a random unused password for the auth row).
- **Magic link** ("email me a login link", `signInWithOtp`) = simpler passwordless companion; same org gate; zero OAuth config.
- **Real risks to design around:** duplicate auth identity (an un-invited Google sign-in on a preliminary invited `auth.users`), un-invited sign-ins landing in no-org (must be blocked/held), Apple's per-session obfuscated emails (skip Apple v1).
- **Manual setup (user-only, cannot be scripted):** create a Google OAuth app in Google Cloud, add the client ID/secret + redirect URL to the Supabase project's Auth providers.
- **Build ~2 days** (Google + magic link + org-membership gate). Apple/Microsoft = lower ROI, defer.

### 2. Invite / email reliability
- "Link expires in X hours" countdown on `/accept-invite`.
- ~~Explicit **verify-on-click** (button) rather than implicit verify on page load , further defangs Safe-Links prefetch.~~ **SHIPPED 2026-08-18** (pilot bug): invite emails now carry only the invite id; `/api/accept-invite/claim` mints a fresh token on the Continue click.
- Admin **"extend expiry"** action on the Invites page (+7 days) instead of delete + resend.
- **Auto-retry** failed invite emails (background job, exponential backoff 5m/15m/1h) instead of manual resend only.
- ~~Consider a longer OTP lifetime for invite links (24-48h) so a slow form-fill doesn't expire.~~ Superseded by claim-at-click (same 2026-08-18 change): the token is minted seconds before use, so the emailed link lives the invite row's full 7 days regardless of OTP lifetime. Password-reset links still verify on page load and remain prefetch-burnable; same claim pattern is the fix when it bites.

### 3. MFA / 2FA (TOTP) for owners + platform admins
Supabase built-in TOTP. Optional for org owners/admins, graduating to mandatory for platform admins. Strongest "official" signal for high-value accounts. Moderate effort.

### 4. Account lockout (app-level brute-force)
Per-email failed-attempt throttle (e.g. lock 15 min after 5 fails) on top of Supabase's per-IP limit. Needs a `login_attempts` table.

### 5. Bigger epics (own projects, higher risk/effort)
- **httpOnly cookie sessions** instead of localStorage (removes the XSS token-theft exposure). Whole-auth refactor + a `/auth/callback` route + SDK cookie config; risky, test refresh flow carefully.
- **Private storage buckets + signed URLs** (avatars/job-photos/property-photos/message-attachments are currently public). Audit item H5, deferred; ~10 days, touches every image render path.
- **Session/idle timeout** (auto re-auth after N min inactivity).
- **Email verification** for a real homeowner self-signup flow (only relevant if self-signup is (re)built; invites are already trusted).
- **Apple / Microsoft OAuth** (after Google proves out).

## Related memory / docs
- Security audit context + already-shipped fixes: the 2026-06-12 audit (7-agent).
- Invite Safe-Links fix: [[reference_invite_email_scanner]]. Invite state machine: [[reference_invite_flow]].
- Auth email monitoring: [[project_auth_email_monitoring]].
