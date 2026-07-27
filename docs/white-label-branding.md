# White-label branding (Phase 0)

> **Status:** Design locked 2026-07-27 (Bridger + Claude). Implementation plan:
> `docs/white-label-branding-plan.md`. This doc is the **why and what**; the plan is the **how**.
> **Strategy source:** `/Users/bridgerdavidson/ai-os/projects/nexxus-service-solutions/strategy-decisions/2026-07-26-build-roadmap.md`
> (Phase 0), with `2026-07-26-pricing-decision.md` and `2026-07-26-onboarding-design.md` as companions.

## Why this is the first build

White-label branding is included **at every tier, including Starter** (pricing decision, 2026-07-26):
branding IS the product, and gating it would make Starter a demo. BookingKoala charges $197/mo to
remove their branding and users resent it; our pricing page answer is "no 'powered by' badge, on any
plan, ever."

It is built before billing because the signup wizard's magic moment ("your whole branded app in 60
seconds") needs these internals to exist, and because a live brand-takeover demo is the pre-sell
weapon for the first outside customers.

## Verified starting state (audited 2026-07-27 against master)

| Area | Reality |
|---|---|
| Schema | `organizations` has `name` + `logo_url` (a pasted URL) only. No color columns. |
| `logo_url` | Loaded into `AuthContext`, editable in settings, **rendered nowhere**. |
| Operator rail | `OperatorRail.tsx` hardcodes `/brand/logo-black.svg` / `logo-white.svg`. |
| Homeowner / cleaner | Top bars are greeting + bell + avatar. **No logo slot, and no `<h1>`** on the home/today views: the greeting is a `<p>` doing double duty as page identity. Account pages do have real `<h1>`s. |
| Tokens | `globals.css` has shadcn HSL-channel vars for both `:root` and `.dark`. ~103 semantic `*-primary` utilities. |
| Brand ramp | `tailwind.config.js` `brand.50`–`brand.950` are **hardcoded hex**, consumed by **219 literal `brand-N` utilities across 90 files** (~10 with `/NN` opacity modifiers). 6 raw brand hex stragglers in `src` outside email. |
| Loader | `NexxusLoader` geometry is literally the Nexxus mark. `FullPageLoader` renders in every role layout **while `orgStatus === "loading"`, i.e. before the org is known**. |
| PWA | **No manifest exists.** Only `appleWebApp: { title: "Nexxus" }` + static `icon.png` / `apple-icon.png` / `icon.svg`. Not a real PWA today. |
| Org context | `AuthContext` loads the user's **first** `organization_members` row. No switcher, no deterministic ordering. |
| Storage precedent | `property-photos` bucket with org-scoped RLS (migrations 054 / 077 / 079). |
| Email | `cardLinkEmail.ts` mirrors brand hex inline; footer reads "Sent by {org} via Nexxus". |
| Pre-auth, org-known | `/billing/add-card` is reached from an emailed link whose token identifies the org. |

## Decisions

### 1. Two logo assets, not one

The rail today loads **one** image and clips it: a 40px-wide wrapper shows only the leftmost 40px of
the lockup (the icon), and on hover the wrapper widens to 150px so the wordmark is revealed in place.
The icon never moves, resizes, or crossfades. That works because we authored a logo whose left 40px
is a self-contained mark.

It breaks four ways for tenants: a wordmark-only logo clips to its first two letters; a stacked
lockup clips to the left column of both rows; a circular badge fits collapsed but has nothing to
reveal; a long name gets its tail cut at 150px.

**Decision:** ask for two assets, mirroring what we already have in `public/brand/` (`icon-color.svg`
and `logo-black.svg`).

- **App icon** (square-ish mark) — collapsed rail, mobile nav, favicon, email header, avatar fallback.
- **Full logo** (lockup or wordmark) — expanded rail, mobile drawer header, wide slots.

Both optional. Collapsed shows the icon, expanded shows the full logo, crossfading at the same left
edge: when a tenant's full logo does begin with their icon the crossfade is nearly invisible and reads
like today's reveal; when it doesn't, it reads as an intentional swap rather than a broken crop.
`object-contain object-left` with a max width means long wordmarks scale to fit instead of clipping.

**Rejected:** asking owners to self-diagnose their logo shape to pick a rail mode. They don't know
our layout constraints, and it couples logo shape to rail behavior for no reason.

### 2. Initials monogram is the universal fallback

No logo uploaded → render the org's initials in a rounded square filled with their brand color. This
makes a brand-new trial org visibly *theirs* the moment they pick a color, before they've found their
logo file — a cheap, large win for the wizard's 60-second magic moment.

### 3. One brand color, fixed neutrals, honored exactly

The tenant picks one color. Neutrals (`warm-*`) and status ramps (`positive` / `caution` / `critical`
/ `info`) never change.

**If their color is too light for white text, we do not silently darken it.** We honor it and flip
`--primary-foreground` to near-black. Silently turning a chosen yellow into brown is dishonest; the
live preview shows them the consequence and lets *them* decide to change it. (Bridger, 2026-07-27.)

**Brand-colored text is a separate problem from text on brand.** `--primary-foreground` only fixes
what sits *on* a brand fill. The codebase also has **52 `text-brand-600` usages across 42 files** —
brand-colored text on a neutral surface. Because step 600 is the tenant's exact color, a pale brand
makes every one of them unreadable, which is what "honor it exactly" would otherwise cost us.

Resolved with a dedicated token, `--brand-ink`: the step used for brand-colored text on neutral
surfaces. It resolves to the lightest of steps 600, 700, or 800 that clears 4.5:1 against the
background, per theme (against warm-50 in light, against the dark card in dark). Steps 700 and up
have fixed lightness targets regardless of input, so a readable option always exists. Its default
is today's brand-600 exactly, so adopting it changes nothing for Nexxus.

The rule that follows: **`brand-600` is a fill color, `brand-ink` is a text color.** Never
`text-brand-600` on a neutral surface.

**Green-branded tenants** blur the brand/`in progress` versus `done` distinction, since `--primary`
serves both. Accepted: status ramps stay fixed because semantic colors must stay semantic, and the
design system already mandates that color is always accompanied by an icon and label. Status hue
comes from the bookings-presenters badge map and is never derived from brand.

### 4. Derive in OKLCH, emit HSL channels

Naive HSL lightness steps produce muddy, oversaturated mid-tones for some hues. The ramp is built in
OKLCH and converted to HSL channels for the CSS variables, gamut-clamped so no step falls outside
sRGB.

**One ramp serves both themes.** The current `.dark` block already works this way: its
`--primary: 225 100% 59%` is exactly `brand-500` and its `--ring: 225 100% 68%` is exactly
`brand-400`. So dark mode is not a second ramp, it is the same ramp referenced at lifted steps. Only
the foreground needs two values (white-or-black against `brand-600` for light, against `brand-500`
for dark), exposed as `--brand-fg-600` and `--brand-fg-500`.

The tenant's chosen hex **is** `brand-600` exactly, unmodified. Every other step keeps that color's
hue, targets a fixed OKLCH lightness, and scales its chroma.

### 5. Tokenize the Tailwind ramp instead of sweeping 90 files

Repoint `brand.50`–`brand.950` from hex to `hsl(var(--brand-N) / <alpha-value>)`, with today's values
as defaults in `globals.css`. All 219 literal utilities become themeable in one config change, and
the `<alpha-value>` form preserves the existing `brand-600/40`-style opacity usages.

### 6. Brand must be applied before first paint

Every role layout renders `<FullPageLoader />` while `orgStatus === "loading"` — **before the org is
known**. Generalized: on every cold load the app paints default Nexxus blue and then snaps to the
tenant's color.

**Fix:** cache the resolved brand in `localStorage` and set the CSS variables from an inline script in
the document head, before hydration. Returning users never see the flash. This is the same mechanism
the queued dark-mode work needs, so it is built once, here.

### 7. Org selection must become deterministic

`AuthContext` picking the "first" membership row is arbitrary. Branding makes that mis-scoping
visible for the first time — a cleaner working for two companies would see the wrong company's logo.

**Fix:** deterministic membership ordering, the user's last-used org persisted and restored, and a
switcher in the account menu that appears **only** when the user belongs to more than one org.
Isolated into its own PR because `AuthContext` holds all the sign-in/sign-out race invariants.

### 8. Loaders

`NexxusLoader` stays on surfaces that are genuinely ours: login, signup, marketing, `/owner`. Inside
tenant surfaces the loader becomes the org's icon with a gentle pulse, falling back to a
brand-colored indicator with no mark. Porting the traveling-mask animation to arbitrary uploads is not
feasible — it needs authored stroke geometry.

### 9. Favicon, theme-color, and title now; installable PWA identity deferred

Favicon, `<meta name="theme-color">`, and `document.title` all follow the org once it is known. Today
every dashboard tab reads "Nexxus"; a homeowner's tab should read their cleaning company.

A per-org **installed** app name and icon needs the manifest, which is fetched before login and
therefore needs org-scoped URLs (subdomains or a slug). Pre-auth branding is deliberately out of scope
(decision 10), so this is deferred. Note for the future: "my customers install *my* app" is the
strongest argument for eventually doing subdomains.

### 10. Pre-auth stays Nexxus, with one exception

Login and signup stay Nexxus-branded: the org is genuinely unknown there. **`/billing/add-card` is the
exception** — it is pre-auth but org-known, because the emailed token identifies the org. It gets
branded.

### 11. No "Powered by Nexxus" in any app surface

Not in homeowner, cleaner, or operator. It contradicts the thing the pricing doc calls the product,
and it is the exact move competitors are resented for. The growth-loop argument is weak here: the
audience seeing a badge is homeowners, who will never buy cleaning software; the loop that matters is
one cleaning-company owner telling another, which is helped by them loving the white-label.

Platform attribution is kept where it is honest rather than promotional: the existing "Sent by {org}
via Nexxus" email footer (good anti-phishing practice), the login/signup pages, and legal/receipt
fine print.

### 12. Rail expansion is a navigation preference, not a branding setting

Decisions 1 and 2 already solve the odd-logo problem, so a persistent-expand mode is not a branding
workaround. It ships as a plain **per-user** preference ("Sidebar: expands on hover / always
expanded"), defaulting to collapsed, the way Linear and Notion do it. Framing it as branding would
make it owner-only and strand every other operator with the owner's choice.

### 13. Greeting moves into the page body

The homeowner and cleaner top bars become the tenant's logo on the left with bell and avatar on the
right, persistent on every screen. The greeting moves into the body of the home/today view as a real
`<h1>`, where it can be warmer and carry context.

Rationale beyond branding: a sticky greeting follows the user into Cleanings, Messages, and booking
flows where it is noise, while a logo earns its keep by being everywhere. This also closes an existing
accessibility gap — those views have no `<h1>` today. A few main views need a proper heading added as
part of the change.

### 14. Uploads are PNG/WebP only

SVG is safe rendered through `<img>`, but a malicious SVG sitting in public storage executes if
someone navigates to the file URL directly. PNG/WebP only in v1, with size and dimension caps.
SVG with server-side sanitization is a possible follow-up.

### 15. Surfaces explicitly excluded

- `/owner` platform back-office — ours, never injected.
- The impersonation banner stays loud and Nexxus-neutral so you always know whose account you're in
  (the tenant's brand *should* apply around it — that's the point of impersonating).
- Marketing site and landing page — ours.

## Data model

Four columns on `organizations`:

| Column | Purpose |
|---|---|
| `brand_color` | The one hex the tenant picks. Null = Nexxus default. |
| `logo_icon_url` | Square-ish mark. Null = initials monogram. |
| `logo_full_url` | Lockup or wordmark. Null = icon + org name as text. |
| `brand_updated_at` | Cache-busting for CDN-served logos. |

New public `org-branding` storage bucket with org-scoped RLS modeled on `property-photos`
(migrations 054 / 077 / 079). Public rather than signed because logos are also embedded in email.

Editing branding is **owner + admin** (today's org-profile route is owner-only).

## Module boundaries

- `src/lib/branding/palette.ts` — pure. Hex in; one 11-step ramp plus the two foreground values out.
  No React, no DB, fully unit-testable.
- `src/lib/branding/monogram.ts` — pure. Org name in, initials out.
- `BrandProvider` — reads the org's brand, writes CSS variables, maintains the `localStorage` cache.
- The pre-paint inline script — reads the cache and sets variables before hydration.
- Render sites consume tokens only. No component reads `brand_color` directly.

## Deferred, deliberately

| Item | Blocked on / reason |
|---|---|
| Installable per-org PWA identity | Needs org-scoped URLs (subdomains). No manifest exists today. |
| Dark-mode logo variants | Dark mode itself is not shipped yet; rides with that workstream. |
| Per-org email sender domains (`noreply@theircompany.com`) | Per-org domain verification in Brevo. Middle ground shipped now: from-name = org, reply-to = org billing email, branded body. |
| Stripe-hosted page branding (Connect onboarding, portal, receipts) | Stripe Dashboard configuration; a real white-label leak, knowingly accepted. Existing ops to-do. |
| SVG uploads | Needs server-side sanitization. |

## Success criteria

1. An org owner sets one color and uploads two logos in settings, and the entire app — operator,
   homeowner, and cleaner — reflects it.
2. A returning user never sees a flash of default blue.
3. An org with no logo and no color still looks intentional (Nexxus defaults), and an org with a color
   but no logo looks like theirs (monogram).
4. A user in two orgs sees the right brand, deterministically.
5. Nothing about the palette can produce unreadable text, at any brand color.
