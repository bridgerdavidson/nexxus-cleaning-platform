# Brainstorming session log: cleaner-decides-payment payout model

Date: 2026-07-23
Goal: full design spec (design only, no build) for the third payout model — "Cleaner sets their rate."
Entry: Task #3 / MASTER-TODO §8, opened by Bridger today.

## Context loaded before questioning

- Code today: `organizations.default_payout_model` = `'percentage_contractor' | 'hourly_external'`.
  Percentage = % of gross via Connect transfer (`computePaymentSplit`); hourly_external = payoutPercent 0, org pays crew outside app.
- Website promise (PayModelsSection): "Cleaner sets their rate — let independent cleaners name their
  price per job and accept the work that fits. Maria's rate for this job $95, Maria keeps $95, paid to
  their bank after the job automatically. For marketplaces and independent contractor networks."
- Prep memory: build this FIRST, pilot org runs on it, "completely changes the entire payout system."
- Money invariants that carry over: platform-held charge, separate transfers (idempotency
  `cleaner-payout-${appointmentId}` / `tenant-payout-${appointmentId}`), 1% platform fee on gross funded
  by org, cleaner cut untouched by fees, processing grossed-up onto payer, payment_events ledger +
  reconcile sweep as backstop.

## Q&A

### Q1: What's driving this model?
**A (Bridger):** Strictly for the pilot. Nexxus already works this way: job for homeowner is e.g. $350;
cleaner is NOT told the price; cleaner does the job, then tells Nexxus how much they want to be paid.
Nexxus pays that (or negotiates) and pockets the rest. They like earning more when the cleaner charges
less; the cleaner never knows the job's worth. Nexxus proposed a threshold: if the request leaves them
enough margin (e.g. they keep >= 20% of job price: $250 request on $350 auto-approves), it goes through
automatically; below that (e.g. $340 on $350), it escalates to Nexxus to approve/decline and counter
with what the cleaner could make. Bridger wants to (a) see if this generalizes as a catch-all model for
non-cleaning-company orgs who don't want % contractors, and (b) HONEST assessment - if it's not worth it,
he'll push Nexxus toward the structured models instead.

Key mechanical facts extracted: pay determined AFTER completion by cleaner request; auto-approve
threshold = min org margin %; escalation = approve/decline/counter; cleaner never sees customer price
(maps to existing `cleaner_pay_display: 'payout_only'`); website copy ("name price per job, accept work
that fits" = pre-job) does NOT match the real flow (post-job) - marketing mismatch to note.

### Q2: Does the cleaner's after-job report ever change the CUSTOMER price?
**A: Price locked at booking.** Homeowner price set at booking, charged at completion exactly as today.
The cleaner's request only splits the fixed pie. Charge path untouched; this is a settlement-side model.

### Q3: When does the cleaner submit the pay request?
**A: Part of completing the job (required step).** "How much for this job?" lives in the mark-complete
flow. Request exists at completion; auto-approved payouts can settle immediately; no dangling
requestless jobs, no nudge/timeout system needed.

### Q4: Escalation shape when a request breaches the threshold?
**A: Counter + cleaner accepts.** Org approves as-is OR counters an amount (+optional note); cleaner
accepts or counters back (a new number re-runs the auto-approve threshold). Money only moves on a
number both sides touched. In practice ~1 round.

### Q5: Model scope - and Bridger's two-umbrella idea
Bridger floated (explicitly "don't take as decided"): collapse three models into TWO - (1) fully
flexible contractor model (mix-and-match per cleaner) and (2) cleaning company w/ availability.
**Code check confirms his instinct:** `payout_model` is ALREADY per-cleaner on cleaner_profiles
('percentage' | 'hourly_external'); all four settlement paths branch on the cleaner's value;
`organizations.default_payout_model` is only the default for new cleaners. Flat-rate-per-job is
marketing-only (not in code). **Direction adopted: "cleaner decides" = a third per-cleaner pay mode
under a flexible-contractor umbrella (percentage | flat | request), not a sibling org-level model.**
Umbrella 2 (hourly + availability) untouched by this spec.

### Q6: What does a request-mode cleaner see about the job's money?
**A: Follow org's existing `cleaner_pay_display` setting.** Nexxus runs 'payout_only' so price stays
hidden; an open-books org could show it. Zero new settings. Accepted trade-off (noted): the
auto-approve threshold leaks price info over repeated requests (bracketing); can't be prevented.

### Q7: Cancellation/no-show fee when a request-mode cleaner was assigned?
**A: Org keeps it all** (minus the 1% platform fee). Cleaner gets $0 in-app; org compensates offline
if they choose. cleanerCents = 0 on the cancellation-fee split for request-mode cleaners.

### Q8: Spec scope
**A: All of it.** Request mode + flat-per-job mode + the per-cleaner pay-mode picker / umbrella
framing in settings. One spec, one implementation plan; delivers website model 1 + model 3.

## Design presentation

### Part 1 (APPROVED by Bridger)
- Storage approach A chosen: `pay_requests` + `pay_request_offers` child table (full offer history).
- Taxonomy: unified per-cleaner value space `percentage | flat | request | hourly_external`; org
  default_payout_model maps percentage_contractor -> percentage via migration; cleaner value governs.
- Lifecycle: request rides mark-complete atomically; auto-approve iff request <= price x (1 -
  min_margin_bps/10000); min_margin_bps org setting, snapshotted per offer; escalate -> pending_org ->
  counter -> pending_cleaner -> accept/counter loop; over-price requests ALLOWED (escalate, no leak),
  approvals hard-capped at job price (org-facing constraint only); no timeouts, stalled threads sit
  visibly with age.
- Money: homeowner charged at completion regardless of request state; transfers defer until approval
  (T1-4 pattern, reconcile sweep backstop); cleanerCents = approved amount; fee = min(1% gross, gross -
  cleanerCents); self-pay unchanged w/ notional-price threshold; cancellation fee cleaner $0; refund
  unwind unaffected (operates on amounts).

### Part 2 (APPROVED by Bridger)
- Schema: cleaner_profiles.payout_model += 'flat'|'request', flat_rate_cents; organizations
  default_payout_model unified + min_margin_bps (default 2000, 0 = all auto); pay_requests (1:1
  appointment, status pending_org|pending_cleaner|approved, approved_via auto|org|cleaner_accept,
  price snapshot, realtime + REPLICA IDENTITY FULL); pay_request_offers (actor, amount, note,
  threshold snapshot, auto_approved flag); payouts += pay_request_id + payout_model_snapshot.
- API: mark-complete accepts request_cents (required iff request-mode) atomically; 3 thread routes
  (org approve, org counter capped at price, cleaner respond accept-or-new-amount).
- Cleaner UX: required completion step anchored by own history only; instant auto-approve feedback;
  earnings states awaiting-approval/countered; thread view w/ accept or counter-back; flat mode = no
  new steps.
- Org UX: settings umbrella (default mode + min-margin + per-cleaner mode/param); Payments "Pay
  requests" queue (price, request, resulting margin $ + %, age; Approve/Counter); nav badge realtime;
  gate = existing payments manager permission (verify at plan time).
- Events: payment_events pay_request.submitted/.auto_approved/.escalated/.countered/.accepted
  (admin audience); state on pay_requests, ledger stays forensic.
