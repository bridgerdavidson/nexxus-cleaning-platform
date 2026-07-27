# Payments Audit v4 — Pre-MVP Money-Code Audit (2026-07-16)

Full-surface audit of every money path (charges, refunds, payouts, webhooks, reconciliation) plus admin/homeowner visibility and notifications. Run as a 7-domain multi-agent audit with adversarial verification of findings.

- **Detail companion**: `docs/payments-audit-v4-findings-detail.md` has all 67 raw findings with code evidence, failure scenarios, verifier verdicts, and corrections. Item IDs below (M1, M2, ...) map to titles there.
- **Verification status**: 37 findings adversarially CONFIRMED, 29 marked ⚠ (verifier never ran — audit was stopped early), 1 refuted (excluded except as a note). Several ⚠ items were independently corroborated by a second domain's confirmed finding; those are noted.
- **Prod flag state at audit time**: tenant Connect ON, new charge flow ON, fee passthrough ON; ACH OFF, self-pay OFF. Tiers reflect that.
- **Branch caveat**: audit ran on the `feat/platform-fee-1pct` worktree (merged as PR #162). Master may have since gained PR #161's homeowner charge-failed bell; re-check M11 against master before working it.

**Verdict**: the core money movement (split math, double-charge protection, idempotency, webhook claim semantics, route authz, operator happy-path UI) is solid and verified. The failure/edge paths and the notification layer are not release-ready.

---

## Tier 1 — Live in prod: money moves wrong or is silently lost

- [ ] **M1 · CRITICAL · CONFIRMED — Failed transfer reversal during a refund is never retried and never alerted; platform permanently eats the money.**
  `src/lib/payments/clawback.ts:331`, `src/lib/payments/reconcile.ts:589`, `refund/route.ts:155-182`. Refund pays the homeowner from the platform balance first; if the tenant/cleaner reversal then fails it logs `transfer_reversal_failed`/`refund_clawback_failed` to `payment_events` (write-only table), the webhook is marked processed, and the sweep only retries `cleaner_clawback_failed`. Fix: retry these event types in the sweep + platform alert.

- [ ] **M2 · HIGH · CONFIRMED — Refund unwind reverses cleaner transfers already at the bank (`bank_paid` guard bypassed).**
  `src/lib/payments/clawback.ts:296