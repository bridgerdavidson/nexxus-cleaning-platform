# Cursor Agent Instructions: Disable Stripe in Production (Keep Working Locally)

## Goal
Stripe payments are implemented and working **locally**, but we do **NOT** want Stripe enabled in **production** yet. Production currently fails because it expects Stripe secrets in `.env`. We already set:

- `STRIPE_ENABLED=false` in production env

Your job: make Stripe fully optional so **prod builds and runs with zero Stripe secrets**, while local dev can still use Stripe when enabled.

---

## Success Criteria

### When `STRIPE_ENABLED=false` (production)
- App builds and runs with **no Stripe env vars**
- No runtime crash due to missing Stripe keys
- Stripe-related API routes return **404** (or **501**) and do not touch Stripe SDK
- Stripe UI is hidden (recommended)

### When `STRIPE_ENABLED=true` (local)
- Existing Stripe flows still work
- Stripe routes work normally

---

## Step 1 — Add and standardize feature flags
We already have `STRIPE_ENABLED=false` in production. Keep using it as the **server** flag.

Add a **client** flag for UI gating:

- Local `.env.local`: `NEXT_PUBLIC_STRIPE_ENABLED=true`
- Production env: `NEXT_PUBLIC_STRIPE_ENABLED=false`

Create a small helper (adjust path to project conventions), e.g. `src/lib/stripe/flags.ts`:

```ts
export function stripeEnabled() {
  return process.env.STRIPE_ENABLED === "true";
}

export function stripeUiEnabled() {
  return process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";
}
```

---

## Step 2 — Remove ALL import-time Stripe initialization (critical)
**This is the most common reason prod demands secrets.** If the Stripe SDK is initialized at module scope, it can crash at build/runtime even when Stripe is disabled.

### Find offenders
Search for:
- `new Stripe(`
- `STRIPE_SECRET_KEY!`
- `process.env.STRIPE_SECRET_KEY`

Examples of problematic code:

```ts
import Stripe from "stripe";
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "..." });
```

### Fix: lazy initialization only when enabled
Create/modify `src/lib/stripe/server.ts` (or your existing stripe helper file):

```ts
import Stripe from "stripe";
import { stripeEnabled } from "./flags";

export function getStripe() {
  if (!stripeEnabled()) throw new Error("Stripe disabled");

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");

  return new Stripe(key, { apiVersion: "2024-06-20" });
}
```

**Rule:** no `new Stripe(...)` at top-level anywhere. Only inside functions that run after the flag check.

---

## Step 3 — Guard every Stripe API route early
For each Stripe route, short-circuit **before** any Stripe usage.

### App Router routes
Typical paths:
- `app/api/stripe/setup-intent/route.ts`
- `app/api/stripe/charge/route.ts`
- `app/api/stripe/webhook/route.ts`
- etc.

Add at top of each handler:

```ts
import { stripeEnabled } from "@/lib/stripe/flags";
import { getStripe } from "@/lib/stripe/server";

export const runtime = "nodejs"; // keep Node for webhooks and stripe-node

export async function POST(req: Request) {
  if (!stripeEnabled()) {
    return new Response("Stripe disabled", { status: 404 });
  }

  const stripe = getStripe();
  // ... existing logic
}
```

### Pages Router routes
If using `pages/api/stripe/*.ts`, same idea:

```ts
import type { NextApiRequest, NextApiResponse } from "next";
import { stripeEnabled } from "@/lib/stripe/flags";
import { getStripe } from "@/lib/stripe/server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!stripeEnabled()) return res.status(404).send("Stripe disabled");
  const stripe = getStripe();
  // ...
}
```

---

## Step 4 — Webhook specifics (keep it safe)
1. Ensure webhook route also returns 404 when disabled.
2. Ensure raw body is used (`await req.text()`), not `req.json()`.
3. Ensure it runs in Node runtime.

Example pattern:

```ts
if (!stripeEnabled()) return new Response("Stripe disabled", { status: 404 });

const sig = req.headers.get("stripe-signature");
const body = await req.text();
const stripe = getStripe();

// stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!)
```

Also: do not require `STRIPE_WEBHOOK_SECRET` unless `STRIPE_ENABLED=true`.

---

## Step 5 — Guard ANY Stripe usage outside API routes
Stripe may be imported/used in:
- server actions
- job runners / cron routes
- admin pages
- “service layer” modules

Search for:
- `paymentIntents.create`
- `setupIntents.create`
- `checkout.sessions.create`
- `.webhooks.constructEvent`
- imports from `@/lib/stripe/*`

Wrap those entry points:

```ts
import { stripeEnabled } from "@/lib/stripe/flags";

if (!stripeEnabled()) {
  // return early, or throw a controlled error that the UI/admin can handle
}
```

Avoid importing Stripe client/server libs in modules that execute in normal prod paths when disabled.

---

## Step 6 — Fix env validation so Stripe vars are not required when disabled
If the repo has env validation (zod/envalid/custom), it may be forcing Stripe vars even when disabled.

Search for files like:
- `env.ts`, `config.ts`, `validateEnv.ts`
- zod schema declaring Stripe keys as required
- `process.env.X!` in a config module that runs at import-time

### Desired behavior
- If `STRIPE_ENABLED === "true"`, require:
  - `STRIPE_SECRET_KEY`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_WEBHOOK_SECRET` (if webhook route exists/enabled)
- If `STRIPE_ENABLED !== "true"`, DO NOT require any Stripe vars

Implement conditional validation accordingly.

---

## Step 7 — Hide Stripe UI in production (recommended)
Any UI that renders Stripe Elements or shows “Save card / Pay” should be gated by `NEXT_PUBLIC_STRIPE_ENABLED`.

Example:

```tsx
const enabled = process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";
if (!enabled) return null; // or <ComingSoon />
```

### Important
Don’t import Stripe Elements (`@stripe/react-stripe-js`, `@stripe/stripe-js`) at the top of components that render in production.
If needed, move Stripe UI into a separate component that is only rendered when enabled.

---

## Step 8 — Production env should be minimal
In production, set:
- `STRIPE_ENABLED=false`
- `NEXT_PUBLIC_STRIPE_ENABLED=false`

And **do not set** any of:
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

(If they are set already, they can remain, but goal is to not require them.)

---

## Step 9 — Smoke tests

### Local dev (Stripe ON)
1. Set `.env.local`:
   - `STRIPE_ENABLED=true`
   - `NEXT_PUBLIC_STRIPE_ENABLED=true`
   - add test keys: `sk_test...`, `pk_test...`, and webhook `whsec...` as needed
2. Run:
   - `npm run dev`
   - `stripe listen --forward-to localhost:3000/api/stripe/webhook`
3. Confirm existing flows still work.

### Production/staging (Stripe OFF)
1. Ensure Stripe secrets are NOT set in env.
2. Deploy with:
   - `STRIPE_ENABLED=false`
   - `NEXT_PUBLIC_STRIPE_ENABLED=false`
3. Confirm:
   - App loads (no crash)
   - `POST /api/stripe/*` returns 404 “Stripe disabled”
   - No Stripe UI is visible

---

## Step 10 — Quick “find the culprit” search terms
Use ripgrep/search:
- `new Stripe(`
- `STRIPE_SECRET_KEY!`
- `STRIPE_WEBHOOK_SECRET!`
- `@stripe/stripe-js`
- `@stripe/react-stripe-js`
- `checkout.sessions`
- `setupIntents`
- `paymentIntents`
- `webhooks.constructEvent`

Most likely offender: a `lib/stripe.ts` exporting a Stripe instance created at import-time.

---

## Deliverables
1. Feature flag helpers + lazy Stripe init
2. Guards added to all Stripe routes and server actions
3. Conditional env validation
4. UI gating via `NEXT_PUBLIC_STRIPE_ENABLED`
5. Confirm production deploy runs without Stripe secrets and without Stripe features enabled
