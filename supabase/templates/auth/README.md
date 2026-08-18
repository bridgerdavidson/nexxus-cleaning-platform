# Supabase Auth email templates

Branded versions of the GoTrue (Supabase Auth) emails, matching the app email design
system (`src/lib/email/templates/receiptEmail.ts` / `cardLinkEmail.ts`: warm neutral
background `#F7F6F3`, white card, `#E6E2DB` hairline, Nexxus blue `#0150FC` button,
"Sent by Nexxus" footer).

These emails are sent by Supabase Auth, NOT the Brevo transport in `src/lib/email/**`:

| Template | Sent when | File |
|---|---|---|
| Invite user | `inviteUserByEmail` (tenant provisioning + every team/homeowner invite) | `invite.html` |
| Reset password | `resetPasswordForEmail` (forgot-password flow) | `recovery.html` |
| Confirm signup | email confirmation (not used by a public flow today, themed anyway) | `confirmation.html` |
| Magic link | magic-link login (not used today, themed anyway) | `magic-link.html` |

## Applying (manual, per project)

Hosted Supabase has no config-as-code path for these (the management MCP has no
auth-template tool), so they are pasted into the Dashboard. Do BOTH projects:

- prod: `ivcqusxdjprurhhrgpot`
- dev: `suaezjtspglgulunkyip`

Dashboard -> Authentication -> Emails (templates tab). For each template above,
set the subject and paste the file's full HTML as the message body:

| Dashboard template | Subject |
|---|---|
| Invite user | You're invited |
| Reset password | Reset your password |
| Confirm signup | Confirm your email |
| Magic link | Your login link |

Keep `{{ .ConfirmationURL }}` intact; it is the only template variable used.

## While in there (deliverability checklist)

- Authentication -> Emails/SMTP: custom SMTP should be the Brevo relay
  (`smtp-relay.brevo.com:587`) with a `@trynexxus.com` sender so DKIM aligns.
  Set the sender display name to `Nexxus`.
- Authentication -> URL Configuration: Site URL and redirect allowlist must
  include the environment's app URL, or link redirects break.
- Authentication -> Rate limits: the email rate limit applies per hour; the
  default is fine for now but raise it before any bulk invite session.

Local dev note: `supabase/config.toml` `[auth.email.template.*]` can point at
these same files if we ever want Inbucket parity locally; not wired today.
