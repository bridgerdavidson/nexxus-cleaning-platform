/**
 * Stripe webhook event dispatcher (extracted from the webhook route in Phase 4b).
 *
 * A single `dispatchStripeEvent(supabase, event)` entry point routes every event type to a
 * focused handler. Keeping it out of the route lets two callers share it:
 *   1. the live webhook (`/api/stripe/webhook`)
 *   2. the dead-letter / reconciliation sweep, which re-fetches a failed event via
 *      `stripe.events.retrieve(id)` and re-dispatches it.
 *
 * Handlers are idempotent and state-guarded so duplicate or out-of-order delivery is safe.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { createConnectTransfer } from '@/lib/stripe';
import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { reverseCleanerTransfer } from '@/lib/stripe/charges/refund';
import { recordPaymentEvent } from '@/lib/payments/events';
import { mapSubscriptionStatus } from '@/lib/payments/orgBilling';

export async function dispatchStripeEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    case 'payment_intent.canceled':
      await handlePaymentIntentCanceled(supabase, event.data.object as Stripe.PaymentIntent);
      break;
    case 'setup_intent.succeeded':
      await handleSetupIntentSucceeded(supabase, event.data.object as Stripe.SetupIntent);
      break;
    case 'charge.refunded':
      await handleChargeRefunded(supabase, event.data.object as Stripe.Charge, event.id);
      break;
    case 'charge.dispute.created':
      await handleChargeDisputeCreated(supabase, event.data.object as Stripe.Dispute, event.id);
      break;
    case 'charge.dispute.closed':
      await handleChargeDisputeClosed(supabase, event.data.object as Stripe.Dispute, event.id);
      break;
    case 'application_fee.refunded':
      await handleApplicationFeeRefunded(supabase, event.data.object as Stripe.ApplicationFee);
      break;
    case 'transfer.reversed':
      await handleTransferReversed(supabase, event.data.object as Stripe.Transfer);
      break;
    case 'payout.paid':
      await handlePayoutPaid(supabase, event.data.object as Stripe.Payout, event.account ?? null);
      break;
    case 'payout.failed':
      await handlePayoutFailed(supabase, event.data.object as Stripe.Payout, event.account ?? null);
      break;
    case 'account.updated':
      await handleAccountUpdated(supabase, event.data.object as Stripe.Account);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpsert(supabase, event.data.object as Stripe.Subscription, event.id, event.type);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription, event.id);
      break;
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      await handleInvoiceEvent(supabase, event.data.object as Stripe.Invoice, event.id, event.type);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

/** Resolve our payment row (+ org/appointment) from a Stripe PaymentIntent id. */
async function findPaymentByIntent(supabase: SupabaseClient, paymentIntentId: string | null) {
  if (!paymentIntentId) return null;
  const { data } = await supabase
    .from('payments')
    .select('id, organization_id, appointment_id, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  return data as
    | { id: string; organization_id: string; appointment_id: string; status: string }
    | null;
}

function idFromExpandable<T extends { id: string }>(v: string | T | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

async function handlePaymentIntentSucceeded(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  console.log('PaymentIntent succeeded:', paymentIntent.id);

  const appointmentId = paymentIntent.metadata?.appointment_id;
  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('payments')
    .update({
      status: 'paid',
      paid_at: nowIso,
      captured_at: nowIso,
      payment_intent_status: paymentIntent.status,
    })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    const { error: fallbackError } = await supabase
      .from('payments')
      .update({
        status: 'paid',
        stripe_payment_intent_id: paymentIntent.id,
        paid_at: nowIso,
      })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');
    if (fallbackError) console.error('Fallback update also failed:', fallbackError);
  }

  console.log('Payment record updated for appointment:', appointmentId);

  // Destination charge (new multi-tenant flow): funds settled to the TENANT, not the
  // platform balance. Settle the cleaner's percentage FROM THE TENANT'S balance (skips
  // hourly_external / unconfigured cleaners). This replaces the legacy platform→cleaner
  // transfer below, which would attempt to move funds the platform doesn't hold.
  if (paymentIntent.transfer_data?.destination) {
    const result = await settleCleanerPayout(
      supabase,
      appointmentId,
      (paymentIntent.latest_charge as string | null) ?? null,
    );
    console.log('Destination charge cleaner settlement:', result);
    return;
  }

  // --- Automatic cleaner payout via Stripe Connect (legacy platform-as-merchant flow) ---
  try {
    const { data: appointment } = await supabase
      .from('appointments')
      .select('cleaner_id, organization_id, total_price')
      .eq('id', appointmentId)
      .single();

    if (!appointment?.cleaner_id) {
      console.log('No cleaner assigned to appointment, skipping payout');
      return;
    }

    const { data: cleanerProfile } = await supabase
      .from('cleaner_profiles')
      .select('stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent')
      .eq('id', appointment.cleaner_id)
      .single();

    if (!cleanerProfile) {
      console.log('Cleaner profile not found, skipping payout');
      return;
    }

    const payoutPercent = Number(cleanerProfile.payout_percent);
    if (
      !cleanerProfile.stripe_connect_account_id ||
      !cleanerProfile.stripe_connect_onboarding_complete ||
      payoutPercent <= 0
    ) {
      console.log('Cleaner payout not configured. Skipping transfer.', {
        hasAccount: !!cleanerProfile.stripe_connect_account_id,
        onboardingComplete: cleanerProfile.stripe_connect_onboarding_complete,
        payoutPercent,
      });
      return;
    }

    const jobPrice = Number(appointment.total_price);
    const cleanerAmountCents = Math.round(jobPrice * (payoutPercent / 100) * 100);
    if (cleanerAmountCents <= 0) {
      console.log('Computed cleaner payout is $0, skipping transfer');
      return;
    }

    const chargeId = paymentIntent.latest_charge as string | null;
    if (!chargeId) {
      console.error('No charge found on PaymentIntent, cannot create transfer');
      return;
    }

    const transfer = await createConnectTransfer(
      cleanerAmountCents,
      cleanerProfile.stripe_connect_account_id,
      chargeId,
      appointmentId,
    );

    console.log('Connect transfer created:', transfer.id);

    const payoutData = {
      organization_id: appointment.organization_id || null,
      cleaner_id: appointment.cleaner_id,
      appointment_id: appointmentId,
      amount: cleanerAmountCents / 100,
      status: 'paid',
      stripe_transfer_id: transfer.id,
      payout_percent_snapshot: payoutPercent,
      paid_at: new Date().toISOString(),
    };

    const { data: existingPayout } = await supabase
      .from('payouts')
      .select('id')
      .eq('appointment_id', appointmentId)
      .single();

    if (existingPayout) {
      await supabase.from('payouts').update(payoutData).eq('id', existingPayout.id);
    } else {
      await supabase.from('payouts').insert(payoutData);
    }

    console.log('Payout record saved for appointment:', appointmentId);
  } catch (payoutError) {
    console.error('Error processing cleaner payout:', payoutError);
  }
}

async function handlePaymentIntentFailed(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  console.log('PaymentIntent failed:', paymentIntent.id, paymentIntent.last_payment_error?.message);

  const appointmentId = paymentIntent.metadata?.appointment_id;
  if (!appointmentId) {
    console.log('No appointment_id in PaymentIntent metadata, skipping');
    return;
  }

  const { error: updateError } = await supabase
    .from('payments')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (updateError) {
    console.error('Error updating payment record:', updateError);
    const { error: fallbackError } = await supabase
      .from('payments')
      .update({ status: 'failed', stripe_payment_intent_id: paymentIntent.id })
      .eq('appointment_id', appointmentId)
      .eq('status', 'pending');
    if (fallbackError) console.error('Fallback update also failed:', fallbackError);
  }

  console.log('Payment marked as failed for appointment:', appointmentId);
}

/**
 * Handle payment_intent.canceled — a held authorization was released (appointment
 * cancelled, or auth superseded by a re-auth). Mirror the canceled status; we keep the
 * payments row (status stays 'pending') for the audit trail rather than deleting it.
 */
async function handlePaymentIntentCanceled(
  supabase: SupabaseClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  const { error } = await supabase
    .from('payments')
    .update({ payment_intent_status: 'canceled' })
    .eq('stripe_payment_intent_id', paymentIntent.id);

  if (error) console.error('payment_intent.canceled: failed to update payment record:', error);
  else console.log('payment_intent.canceled: marked payment canceled for PI', paymentIntent.id);
}

/**
 * Handle setup_intent.succeeded — a homeowner finished a hosted "card link" and saved a
 * card. Close the matching homeowner_payment_links row so the admin UI (which subscribes
 * to it via realtime) reflects "card on file".
 */
async function handleSetupIntentSucceeded(
  supabase: SupabaseClient,
  setupIntent: Stripe.SetupIntent,
) {
  const token = setupIntent.metadata?.token;
  if (!token) {
    console.log('setup_intent.succeeded: no card-link token in metadata, skipping');
    return;
  }

  const { error } = await supabase
    .from('homeowner_payment_links')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      setup_intent_id: setupIntent.id,
    })
    .eq('token', token)
    .eq('status', 'pending');

  if (error) console.error('setup_intent.succeeded: failed to complete card link:', error);
  else console.log('setup_intent.succeeded: card link completed (SI', setupIntent.id, ')');
}

/**
 * Handle charge.refunded — confirms a refund settled at Stripe. Mark our pending `refunds`
 * rows succeeded (match by stripe_refund_id), and if the charge is now fully refunded,
 * ensure the payment reads 'refunded'. The refund route already did the optimistic writes;
 * this is the authoritative confirmation.
 */
async function handleChargeRefunded(
  supabase: SupabaseClient,
  charge: Stripe.Charge,
  stripeEventId: string,
) {
  const refundList = charge.refunds?.data ?? [];
  for (const r of refundList) {
    await supabase
      .from('refunds')
      .update({ status: 'succeeded' })
      .eq('stripe_refund_id', r.id)
      .eq('status', 'pending');
  }

  const piId = idFromExpandable(charge.payment_intent);
  const payment = await findPaymentByIntent(supabase, piId);
  const fullyRefunded = charge.amount_refunded >= charge.amount;

  if (payment && fullyRefunded && payment.status !== 'refunded') {
    await supabase.from('payments').update({ status: 'refunded' }).eq('id', payment.id);
  }

  await recordPaymentEvent(supabase, {
    paymentId: payment?.id ?? null,
    appointmentId: payment?.appointment_id ?? null,
    organizationId: payment?.organization_id ?? null,
    stripeEventId,
    eventType: 'charge_refunded',
    newStatus: fullyRefunded ? 'refunded' : payment?.status ?? null,
    actor: 'webhook',
    amount: charge.amount_refunded,
    payload: { charge_id: charge.id, fully_refunded: fullyRefunded },
  });
}

/**
 * Handle charge.dispute.created — the homeowner disputed a charge. Record the dispute
 * against the owning tenant (merchant of record) so it surfaces in the ops view; Stripe has
 * already debited the disputed funds + fee from the tenant balance.
 */
async function handleChargeDisputeCreated(
  supabase: SupabaseClient,
  dispute: Stripe.Dispute,
  stripeEventId: string,
) {
  const piId = idFromExpandable(dispute.payment_intent);
  const chargeId = idFromExpandable(dispute.charge) ?? '';
  const payment = await findPaymentByIntent(supabase, piId);

  if (!payment) {
    console.warn('charge.dispute.created: no matching payment for dispute', dispute.id, '— skipping insert (manual review)');
    return;
  }

  const evidenceDueBy = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
    : null;

  const { error } = await supabase.from('disputes').upsert(
    {
      organization_id: payment.organization_id,
      payment_id: payment.id,
      stripe_dispute_id: dispute.id,
      stripe_charge_id: chargeId,
      amount: dispute.amount,
      status: dispute.status,
      reason: dispute.reason ?? null,
      evidence_due_by: evidenceDueBy,
    },
    { onConflict: 'stripe_dispute_id' },
  );
  if (error) console.error('charge.dispute.created: failed to record dispute:', error);

  await recordPaymentEvent(supabase, {
    paymentId: payment.id,
    appointmentId: payment.appointment_id,
    organizationId: payment.organization_id,
    stripeEventId,
    eventType: 'dispute_created',
    actor: 'webhook',
    amount: dispute.amount,
    payload: { dispute_id: dispute.id, reason: dispute.reason, evidence_due_by: evidenceDueBy },
  });
  // TODO(ops): notify the tenant admin with the evidence due-by date (alerting channel).
}

/**
 * Handle charge.dispute.closed — if the dispute was LOST and we'd already paid the cleaner,
 * claw back the cleaner's share via transfer reversal (decision #12). The tenant absorbs the
 * remainder + the dispute fee (Stripe already debited those from the tenant balance).
 */
async function handleChargeDisputeClosed(
  supabase: SupabaseClient,
  dispute: Stripe.Dispute,
  stripeEventId: string,
) {
  await supabase
    .from('disputes')
    .update({ status: dispute.status })
    .eq('stripe_dispute_id', dispute.id);

  const piId = idFromExpandable(dispute.payment_intent);
  const payment = await findPaymentByIntent(supabase, piId);

  if (dispute.status !== 'lost') {
    await recordPaymentEvent(supabase, {
      paymentId: payment?.id ?? null,
      appointmentId: payment?.appointment_id ?? null,
      organizationId: payment?.organization_id ?? null,
      stripeEventId,
      eventType: 'dispute_closed',
      newStatus: dispute.status,
      actor: 'webhook',
      payload: { dispute_id: dispute.id, outcome: dispute.status },
    });
    return;
  }

  // Dispute LOST — claw back the cleaner's transfer if one was paid.
  if (payment) {
    const { data: payoutRows } = await supabase
      .from('payouts')
      .select('id, amount, stripe_transfer_id, source_balance_account_id, status')
      .eq('appointment_id', payment.appointment_id)
      .not('stripe_transfer_id', 'is', null)
      .limit(1);
    const payout = payoutRows && payoutRows.length > 0
      ? (payoutRows[0] as {
          id: string;
          amount: number;
          stripe_transfer_id: string;
          source_balance_account_id: string | null;
          status: string;
        })
      : null;

    if (payout?.stripe_transfer_id && payout.source_balance_account_id && payout.status !== 'reversed') {
      const cleanerCents = Math.round(Number(payout.amount) * 100);
      try {
        await reverseCleanerTransfer(payout.stripe_transfer_id, cleanerCents, payout.source_balance_account_id);
        await supabase
          .from('payouts')
          .update({ status: 'reversed', reversed_at: new Date().toISOString() })
          .eq('id', payout.id);
        await recordPaymentEvent(supabase, {
          paymentId: payment.id,
          appointmentId: payment.appointment_id,
          organizationId: payment.organization_id,
          stripeEventId,
          eventType: 'dispute_lost_clawback',
          actor: 'webhook',
          amount: cleanerCents,
          payload: { dispute_id: dispute.id, transfer_id: payout.stripe_transfer_id },
        });
      } catch (err) {
        // Queue for the failed-transfer retry sweep; never throw back into the webhook.
        await recordPaymentEvent(supabase, {
          paymentId: payment.id,
          appointmentId: payment.appointment_id,
          organizationId: payment.organization_id,
          stripeEventId,
          eventType: 'cleaner_clawback_failed',
          actor: 'webhook',
          amount: cleanerCents,
          payload: { dispute_id: dispute.id, error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  }

  await recordPaymentEvent(supabase, {
    paymentId: payment?.id ?? null,
    appointmentId: payment?.appointment_id ?? null,
    organizationId: payment?.organization_id ?? null,
    stripeEventId,
    eventType: 'dispute_lost',
    newStatus: 'lost',
    actor: 'webhook',
    amount: dispute.amount,
    payload: { dispute_id: dispute.id },
  });
}

/**
 * Handle application_fee.refunded — mirror the refunded amount onto our application_fees
 * ledger (relevant only once platform_fee_bps > 0; today fees are 0 so this is a no-op).
 */
async function handleApplicationFeeRefunded(
  supabase: SupabaseClient,
  fee: Stripe.ApplicationFee,
) {
  const { error } = await supabase
    .from('application_fees')
    .update({ refunded_amount: fee.amount_refunded })
    .eq('stripe_application_fee_id', fee.id);
  if (error) console.error('application_fee.refunded: failed to update ledger:', error);
}

async function handleTransferReversed(supabase: SupabaseClient, transfer: Stripe.Transfer) {
  console.log('Transfer reversed:', transfer.id);

  const { data: existingPayout, error: findError } = await supabase
    .from('payouts')
    .select('id')
    .eq('stripe_transfer_id', transfer.id)
    .single();

  if (findError || !existingPayout) {
    console.log('No payout record found for reversed transfer:', transfer.id);
    return;
  }

  const { error: updateError } = await supabase
    .from('payouts')
    .update({ status: 'reversed', reversed_at: new Date().toISOString() })
    .eq('id', existingPayout.id);

  if (updateError) console.error('Error marking payout as reversed:', updateError);
  else console.log('Payout marked as reversed for transfer:', transfer.id);
}

/**
 * Fallback when a payout.paid event can't be tied to specific transfer ids: mark only the
 * SINGLE oldest still-unattributed payout for the cleaner, never the whole set. Stamping every
 * `stripe_payout_id IS NULL` row with this payout's id would claim unrelated payouts and cause
 * wrong reversions on a later payout.failed. Under-marking is self-healing — the precise
 * transfer-id path or the reconcile sweep settles the rest.
 */
async function markOldestUnattributedPayout(
  supabase: SupabaseClient,
  cleanerId: string,
  bankPaidUpdate: { status: 'bank_paid'; stripe_payout_id: string; bank_paid_at: string },
): Promise<number> {
  const { data: candidate } = await supabase
    .from('payouts')
    .select('id')
    .eq('cleaner_id', cleanerId)
    .eq('status', 'paid')
    .is('stripe_payout_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return 0;
  const { data: updated, error } = await supabase
    .from('payouts')
    .update(bankPaidUpdate)
    .eq('id', (candidate as { id: string }).id)
    .select('id');
  if (error) {
    console.error('payout.paid: DB error during narrowed fallback update:', error);
    return 0;
  }
  return (updated ?? []).length;
}

/**
 * Handle payout.paid from a connected account — money landed in the cleaner's bank.
 * Connect events arrive with event.account set to the connected account ID.
 */
async function handlePayoutPaid(
  supabase: SupabaseClient,
  payout: Stripe.Payout,
  connectedAccountId: string | null,
) {
  const arrivalDate = new Date(payout.arrival_date * 1000).toISOString();

  console.log('Payout paid webhook received:', { payoutId: payout.id, connectedAccountId, arrivalDate });

  if (!connectedAccountId) {
    console.warn('payout.paid event missing event.account — Connect webhook not configured. Will be caught by reconcile.', { payoutId: payout.id });
    return;
  }

  const { data: cleaner, error: cleanerError } = await supabase
    .from('cleaner_profiles')
    .select('id')
    .eq('stripe_connect_account_id', connectedAccountId)
    .single();

  if (cleanerError || !cleaner) {
    console.log('No cleaner found for connected account:', connectedAccountId, cleanerError?.message);
    return;
  }

  let transferIds: string[] = [];
  try {
    const { getPayoutTransferIds } = await import('@/lib/stripe');
    transferIds = await getPayoutTransferIds(connectedAccountId, payout.id);
    console.log(`payout.paid ${payout.id}: resolved ${transferIds.length} transfer(s)`);
  } catch (err) {
    console.warn('payout.paid: could not fetch balance transactions, will use fallback:', err);
  }

  const bankPaidUpdate = {
    status: 'bank_paid' as const,
    stripe_payout_id: payout.id,
    bank_paid_at: arrivalDate,
  };

  let count = 0;

  if (transferIds.length > 0) {
    const { data: updatedRows, error: updateError } = await supabase
      .from('payouts')
      .update(bankPaidUpdate)
      .eq('cleaner_id', cleaner.id)
      .eq('status', 'paid')
      .in('stripe_transfer_id', transferIds)
      .select('id');

    if (updateError) console.error('payout.paid: DB error during precise update:', updateError);
    else count = (updatedRows ?? []).length;

    if (count === 0) {
      count = await markOldestUnattributedPayout(supabase, cleaner.id, bankPaidUpdate);
    }
  } else {
    count = await markOldestUnattributedPayout(supabase, cleaner.id, bankPaidUpdate);
  }

  if (count === 0) {
    console.warn('payout.paid: no eligible payout rows updated for cleaner:', cleaner.id, 'payout:', payout.id);
  } else {
    console.log(`payout.paid: marked ${count} row(s) as bank_paid for cleaner ${cleaner.id}`);
  }
}

async function handlePayoutFailed(
  supabase: SupabaseClient,
  payout: Stripe.Payout,
  connectedAccountId: string | null,
) {
  console.log('Payout failed webhook received:', { payoutId: payout.id, connectedAccountId, failureCode: payout.failure_code });

  if (!connectedAccountId) {
    console.warn('payout.failed event missing event.account — Connect webhook not configured.');
    return;
  }

  const { data: cleaner, error: cleanerError } = await supabase
    .from('cleaner_profiles')
    .select('id')
    .eq('stripe_connect_account_id', connectedAccountId)
    .single();

  if (cleanerError || !cleaner) {
    console.log('No cleaner found for connected account on payout.failed:', connectedAccountId);
    return;
  }

  const { data: revertedRows, error: updateError } = await supabase
    .from('payouts')
    .update({ status: 'paid', stripe_payout_id: null, bank_paid_at: null })
    .eq('cleaner_id', cleaner.id)
    .eq('stripe_payout_id', payout.id)
    .select('id');

  if (updateError) console.error('Error reverting payouts after payout.failed:', updateError);
  else console.log(`payout.failed: reverted ${(revertedRows ?? []).length} row(s) for cleaner ${cleaner.id}`);
}

/**
 * Handle account.updated — mirror a connected account's capability + requirements state
 * into our DB (tenant organization OR cleaner, resolved by stripe_connect_account_id).
 */
async function handleAccountUpdated(supabase: SupabaseClient, account: Stripe.Account) {
  const acctId = account.id;
  const chargesEnabled = account.charges_enabled ?? false;
  const payoutsEnabled = account.payouts_enabled ?? false;
  const detailsSubmitted = account.details_submitted ?? false;
  const requirementsDue = account.requirements?.currently_due ?? [];

  const { data: org } = await supabase
    .from('organizations')
    .select('id, stripe_connect_onboarded_at')
    .eq('stripe_connect_account_id', acctId)
    .maybeSingle();

  if (org) {
    const update: Record<string, unknown> = {
      stripe_connect_charges_enabled: chargesEnabled,
      stripe_connect_payouts_enabled: payoutsEnabled,
      stripe_connect_details_submitted: detailsSubmitted,
      stripe_connect_requirements_due: requirementsDue,
    };
    if (detailsSubmitted && !(org as { stripe_connect_onboarded_at: string | null }).stripe_connect_onboarded_at) {
      update.stripe_connect_onboarded_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from('organizations')
      .update(update)
      .eq('id', (org as { id: string }).id);
    if (error) console.error('account.updated: failed to mirror tenant org state:', error);
    else console.log('account.updated: mirrored tenant org state for', acctId);
    return;
  }

  const { data: cleaner } = await supabase
    .from('cleaner_profiles')
    .select('id')
    .eq('stripe_connect_account_id', acctId)
    .maybeSingle();

  if (cleaner) {
    const { error } = await supabase
      .from('cleaner_profiles')
      .update({ stripe_connect_onboarding_complete: detailsSubmitted && payoutsEnabled })
      .eq('id', (cleaner as { id: string }).id);
    if (error) console.error('account.updated: failed to mirror cleaner state:', error);
    else console.log('account.updated: mirrored cleaner state for', acctId);
    return;
  }

  console.log('account.updated: no matching org or cleaner for account', acctId);
}

// ── SaaS subscription billing (Scenario 3, Phase 5) ──────────────────────────────

/** Resolve the owning org for a subscription: metadata first, then the billing Customer id. */
async function resolveOrgForSubscription(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const metaOrg = sub.metadata?.organization_id;
  if (metaOrg) return metaOrg;
  const customerId = idFromExpandable(sub.customer as string | { id: string } | null);
  if (!customerId) return null;
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Append a subscription/invoice event to the audit table (idempotent on stripe_event_id). */
async function recordSubscriptionEvent(
  supabase: SupabaseClient,
  organizationId: string,
  stripeEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from('tenant_subscription_events').upsert(
    { organization_id: organizationId, stripe_event_id: stripeEventId, event_type: eventType, payload },
    { onConflict: 'stripe_event_id', ignoreDuplicates: true },
  );
  if (error) console.error('recordSubscriptionEvent: failed to audit subscription event:', error);
}

async function handleSubscriptionUpsert(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
  stripeEventId: string,
  eventType: string,
) {
  const orgId = await resolveOrgForSubscription(supabase, sub);
  if (!orgId) {
    console.warn(`${eventType}: no matching org for subscription ${sub.id} — skipping`);
    return;
  }
  // current_period_end has moved across Stripe API versions; read it defensively.
  const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
  await supabase
    .from('organizations')
    .update({
      subscription_id: sub.id,
      subscription_status: mapSubscriptionStatus(sub.status),
      subscription_current_period_end: cpe ? new Date(cpe * 1000).toISOString() : null,
    })
    .eq('id', orgId);
  await recordSubscriptionEvent(supabase, orgId, stripeEventId, eventType, {
    subscription_id: sub.id,
    stripe_status: sub.status,
  });
}

async function handleSubscriptionDeleted(
  supabase: SupabaseClient,
  sub: Stripe.Subscription,
  stripeEventId: string,
) {
  const orgId = await resolveOrgForSubscription(supabase, sub);
  if (!orgId) return;
  await supabase.from('organizations').update({ subscription_status: 'canceled' }).eq('id', orgId);
  await recordSubscriptionEvent(supabase, orgId, stripeEventId, 'customer.subscription.deleted', {
    subscription_id: sub.id,
  });
}

async function handleInvoiceEvent(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
  stripeEventId: string,
  eventType: string,
) {
  const customerId = idFromExpandable(invoice.customer as string | { id: string } | null);
  if (!customerId) return;
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  const orgId = (data as { id: string } | null)?.id;
  if (!orgId) return;
  await recordSubscriptionEvent(supabase, orgId, stripeEventId, eventType, {
    invoice_id: invoice.id,
    invoice_status: invoice.status,
    amount_paid: invoice.amount_paid,
    amount_due: invoice.amount_due,
  });
  // invoice.payment_failed degrading tenant access (subscription_status already mirrored by the
  // customer.subscription.updated event) is deferred — see plan Phase 5 / open question.
}
