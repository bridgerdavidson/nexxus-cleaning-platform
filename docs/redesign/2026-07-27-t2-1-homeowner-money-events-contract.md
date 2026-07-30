# T2-1 · Homeowner money events — emit contract (render half shipped)

**Status:** the **render half** (Lane D) is shipped in `src/lib/notifications/labels.ts`
(`describeHomeownerMoneyEvent`). The **emit half** (Lane B money PR) is what makes these rows
actually appear. This doc is the contract between the two: emit rows with exactly these
`event_type` strings and payload fields and the bell + live toast light up with **no further UI
change**.

Audit item: **T2-1 · Homeowner is never proactively notified of any money event** (see
`docs/payments-audit-v4-backlog.md`). Today the homeowner only hears about *failures*
(`charge_failed` homeowner branch from T1-7, `authentication_required`). They get no receipt when a
charge lands, no notice when a refund is issued, and no record when a cancellation/no-show fee is
charged off-session.

## Why the render half could ship alone

`describeNotification(eventType, payload)` is called generically for every row by the bell
(`deriveNotifications.ts`), the panel, and the realtime toast (`useNotifications.ts`) — there is no
event-type allowlist anywhere, and `notificationTab(_, 'homeowner')` already routes all homeowner
rows to `home` while `homeownerNotificationHref` deep-links any appointment-scoped row to
`/homeowner?appointment=<id>`. So the *only* thing missing is the emit.

These three types are rendered in `labels.ts` via a small string-keyed path **ahead of** the
union-typed `build()` switch, and are deliberately **not** in the `NotificationEventType` union or
`KNOWN_TYPES` (that union + the emit sites are Lane-B-owned files this PR does not touch). Until an
emit exists, the branches are simply dormant.

## No migration needed

`notification_events.event_type` is plain `TEXT NOT NULL` (migration 063) with **no CHECK / enum**,
so new event-type strings need no DB migration. Rows already fan to a single recipient via
`recipient_user_id`; dedupe is enforced by the unique index from migration 088.

## The three events

All three are **appointment-scoped** (`appointment_id` set → the row deep-links to
`/homeowner?appointment=<id>`), **homeowner-audience**, delivered to a single recipient:
`recipient_user_id = appointment.homeowner_id`. Set `audience: 'homeowner'` in the payload for
consistency (the labels are homeowner-only by contract).

The denormalized context fields (`property_label`, `scheduled_date`, `scheduled_time`,
`customer_name`, …) come from `loadNotificationContext(supabase, { appointmentId })`, exactly like
the existing money emits. The labels read only the fields listed below; every field is optional and
the copy degrades gracefully when one is missing.

### 1. `charge_succeeded` — completion charge landed (the receipt)

The dispute-prevention notice: the off-session completion charge can land days after booking, so the
homeowner needs a record of it.

| Field | Type | Used for |
|---|---|---|
| `audience` | `'homeowner'` | contract marker |
| `amount_cents` | number | gross charged (the amount that hit the card) |
| `property_label` | string | detail line |
| `scheduled_date` / `scheduled_time` | string | detail line ("MM/DD/YY at h:mm AM/PM") |

Rendered copy: **"Paid $42.00 for your cleaning"** (success tone, CreditCard icon); with no amount,
**"Your cleaning payment went through"**.

- **Emit site:** the completion-charge success path — recommended on `payment_intent.succeeded`
  (`dispatchStripeEvent` / `settleCleanerPayout`) where `charge_kind === 'completion'`, so a captured
  charge is reported once and only after Stripe confirms it. Mirror the homeowner `charge_failed`
  emit in `chargeCompletedAppointment.ts` for the payload/recipient shape.
- **Dedupe key:** `charge_succeeded:${appointmentId}:${paymentIntentId}` (idempotent across webhook
  retries / the reconcile sweep).
- **`receipt_email` (the one-field half of T2-1):** in `createDestinationCharge`
  (`src/lib/stripe/charges/charge.ts`) set `receipt_email: <homeowner email>` on the
  `PaymentIntentCreateParams` so Stripe also sends its native email receipt. Thread the homeowner's
  email through `ChargeParams`. Applies to both the completion charge and the cancellation-fee charge.

### 2. `refund_issued` — a refund is on its way

So the homeowner learns it from the app, not from their bank statement.

| Field | Type | Used for |
|---|---|---|
| `audience` | `'homeowner'` | contract marker |
| `amount_cents` | number | refunded amount |
| `property_label` | string | detail line |

Rendered copy: **"Refund of $42.00 on the way"** (success tone, Banknote icon), detail **"Back to
your card in 5 to 10 days"**; with no amount, **"Your refund is on the way"**.

- **Emit site(s):** wherever a refund is *created* — `refundCancelledCharge.ts` (cancel auto-refund)
  and the operator refund route (`/api/.../refund/route.ts`). This is the homeowner-audience
  counterpart to the admin-only `cancelled_job_refunded` / `refund_failed`; keep those as-is and add
  a homeowner row with `recipient_user_id = homeowner_id`.
- **Dedupe key:** `refund_issued:${refundId}` (one per Stripe refund).

### 3. `cancellation_fee_charged` — a cancel/no-show fee was charged

The post-hoc record so a fee that hits the card off-session is explained.

| Field | Type | Used for |
|---|---|---|
| `audience` | `'homeowner'` | contract marker |
| `amount_cents` | number | fee amount |
| `reason` | `'no_show'` \| `'cancellation'` | word choice ("no-show fee" vs "cancellation fee") |
| `property_label` | string | detail line |
| `scheduled_date` / `scheduled_time` | string | detail line |

Rendered copy: **"You were charged a $42.00 no-show fee"** / **"…cancellation fee"** (warning tone,
CreditCard icon); missing `reason` defaults to a cancellation fee; with no amount, **"A cancellation
fee was charged"**.

- **Emit site:** the **success** path of `chargeCancellationFee.ts` (today only the *failure* path
  notifies, via admin `cancellation_fee_failed`). Set `reason` from the same no-show flag the fee
  computation uses.
- **Dedupe key:** `cancellation_fee_charged:${appointmentId}:${paymentIntentId}`.

## What Lane B should / should not touch in the notification layer

- **Add** the three strings to the `NotificationEventType` union in
  `src/lib/notifications/eventTypes.ts` so the emit code type-checks (mark them homeowner-audience in
  the comment).
- **Do not** add a `build()` case or a `KNOWN_TYPES` entry for them in `labels.ts` —
  `describeHomeownerMoneyEvent` already intercepts these ahead of `build()`, so a duplicate branch
  would be dead code. No `labels.ts` change is required by the emit PR.
- **Tests:** each new emit gets a co-located `*.integration.test.ts` asserting the row lands with
  `recipient_user_id = homeowner_id`, the right `event_type`, and `amount_cents` (and `reason` for
  the fee). The render side is already covered by `labels.test.ts`.

## Files in the render-half PR

- `src/lib/notifications/labels.ts` — `describeHomeownerMoneyEvent` + wiring in `describeNotification`.
- `src/lib/notifications/labels.test.ts` — descriptor coverage for the three types.
- `docs/redesign/2026-07-27-t2-1-homeowner-money-events-contract.md` — this contract.
