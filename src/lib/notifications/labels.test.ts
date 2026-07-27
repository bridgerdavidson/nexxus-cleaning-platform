import { describe, it, expect } from 'vitest';
import { describeNotification, toastVariantForTone, type NotificationTone } from './labels';
import type { NotificationEventType } from './eventTypes';

const EVENT_TYPES: NotificationEventType[] = [
  'homeowner_request_submitted',
  'cleaner_assigned',
  'cleaner_force_assigned',
  'cleaner_counter_accepted',
  'appointment_rescheduled',
  'cleaner_accepted',
  'cleaner_declined',
  'cleaner_counter_proposed',
  'chain_exhausted',
  'cleaner_response_overdue',
  'cleaner_paid',
  'cleaner_payout_bank_failed',
  'pay_request_escalated',
  'pay_request_countered',
  'pay_request_approved',
  'pay_request_accepted',
  'job_started',
  'job_completed',
  'dispute_opened',
  'authorization_failed',
  'authentication_required',
  'charge_failed',
  'cancellation_fee_failed',
  'self_pay_no_card',
  'tenant_payments_not_ready',
  'cleaner_not_payable',
  'cancelled_job_refunded',
  'refund_failed',
  'clawback_blocked',
  'appointment_time_changed',
  'member_joined',
];

const VALID_TONES: NotificationTone[] = ['success', 'error', 'warning', 'info'];

// A payload that exercises every field the builder might read.
const FULL_PAYLOAD = {
  audience: 'admin',
  customer_name: 'Jane Doe',
  cleaner_name: 'Wanda Jones',
  next_cleaner_name: 'Bob Smith',
  property_label: '123 Oak St',
  scheduled_date: '2026-06-06',
  scheduled_time: '14:30',
  suggested_date: '2026-06-07',
  suggested_time: '09:00',
  suggested_times_count: 2,
  amount_cents: 4200,
  evidence_due_by: '2026-06-20T00:00:00.000Z',
};

describe('describeNotification', () => {
  it('maps every known event type to a non-empty title, valid tone, and icon (no payload)', () => {
    for (const t of EVENT_TYPES) {
      const d = describeNotification(t);
      expect(d.title.length).toBeGreaterThan(0);
      expect(VALID_TONES).toContain(d.tone);
      expect(d.icon).toBeTruthy();
    }
  });

  it('uses no em dashes in title or detail (generic and enriched)', () => {
    for (const t of EVENT_TYPES) {
      const generic = describeNotification(t);
      const enriched = describeNotification(t, FULL_PAYLOAD);
      for (const d of [generic, enriched]) {
        expect(d.title).not.toContain('—');
        expect(d.detail ?? '').not.toContain('—');
      }
    }
  });

  it('pay-request copy: enriched titles carry the actor and amount, generic fallbacks stand alone', () => {
    expect(describeNotification('pay_request_escalated', FULL_PAYLOAD).title).toBe('Wanda Jones requested $42.00');
    expect(describeNotification('pay_request_escalated').title).toBe('A pay request needs your review');
    expect(describeNotification('pay_request_countered', FULL_PAYLOAD).title).toBe(
      'New offer on your pay request: $42.00',
    );
    expect(describeNotification('pay_request_approved', FULL_PAYLOAD).title).toBe(
      'Your pay request was approved: $42.00',
    );
    expect(describeNotification('pay_request_approved', FULL_PAYLOAD).tone).toBe('success');
    expect(describeNotification('pay_request_accepted', FULL_PAYLOAD).title).toBe('Wanda Jones agreed to $42.00');
  });

  it('falls back to generic copy when the payload has no names', () => {
    expect(describeNotification('cleaner_accepted').title).toBe('Cleaner accepted the job');
    expect(describeNotification('cleaner_declined').title).toBe('Cleaner declined the job');
    expect(describeNotification('homeowner_request_submitted').title).toBe('New booking request');
    expect(describeNotification('authorization_failed').title).toBe('Card hold failed');
    expect(describeNotification('cleaner_paid').title).toBe('You were paid');
  });

  it('interpolates names into enriched titles', () => {
    expect(describeNotification('homeowner_request_submitted', FULL_PAYLOAD).title).toBe(
      'New booking request from Jane Doe',
    );
    expect(describeNotification('cleaner_counter_proposed', FULL_PAYLOAD).title).toBe(
      'Wanda Jones proposed a new time',
    );
    expect(describeNotification('authorization_failed', FULL_PAYLOAD).title).toBe(
      'Card hold failed for Jane Doe',
    );
    expect(describeNotification('cleaner_paid', FULL_PAYLOAD).title).toBe('You were paid $42.00');
  });

  it('words cleaner_accepted differently for the homeowner vs admin audience', () => {
    const admin = describeNotification('cleaner_accepted', { ...FULL_PAYLOAD, audience: 'admin' });
    const homeowner = describeNotification('cleaner_accepted', {
      ...FULL_PAYLOAD,
      audience: 'homeowner',
    });
    expect(admin.title).toBe('Wanda Jones accepted a job');
    expect(homeowner.title).toBe('Wanda Jones is confirmed for your cleaning');
  });

  it('words authentication_required for admin vs homeowner audience', () => {
    const admin = describeNotification('authentication_required', {
      ...FULL_PAYLOAD,
      audience: 'admin',
    });
    const homeowner = describeNotification('authentication_required', {
      ...FULL_PAYLOAD,
      audience: 'homeowner',
    });
    expect(admin.title).toBe('Card needs verification for Jane Doe');
    expect(homeowner.title).toBe('Confirm your card to secure your booking');
    expect(admin.tone).toBe('warning');
    // No payload -> admin wording with no customer name.
    expect(describeNotification('authentication_required').title).toBe(
      'Card needs identity verification',
    );
  });

  it('shows reassignment (amber) vs escalation (red) for a decline', () => {
    const reassigned = describeNotification('cleaner_declined', {
      cleaner_name: 'Wanda Jones',
      next_cleaner_name: 'Bob Smith',
    });
    expect(reassigned.detail).toBe('Reassigned to Bob Smith');
    expect(reassigned.tone).toBe('warning');

    const escalated = describeNotification('cleaner_declined', { cleaner_name: 'Wanda Jones' });
    expect(escalated.detail).toBe('Needs a new cleaner');
    expect(escalated.tone).toBe('error');
  });

  it('words member_joined for a customer vs a team member', () => {
    const customer = describeNotification('member_joined', {
      member_name: 'Jane Doe',
      member_role: 'homeowner',
    });
    expect(customer.title).toBe('Jane Doe joined as a customer');

    const teammate = describeNotification('member_joined', {
      member_name: 'Sam Lee',
      member_role: 'cleaner',
    });
    expect(teammate.title).toBe('Sam Lee joined your team');
    expect(teammate.detail).toBe('Cleaner');

    // No name -> generic.
    expect(describeNotification('member_joined').title).toBe('A new team member joined');
  });

  it('falls back safely for an unknown / future event type', () => {
    const d = describeNotification('something_new_2099');
    expect(d.title).toBe('Update');
    expect(d.tone).toBe('info');
    expect(d.icon).toBeTruthy();
  });

  it('words charge_failed by reason (decline vs 3-D Secure)', () => {
    const declined = describeNotification('charge_failed', { ...FULL_PAYLOAD, reason: 'declined' });
    expect(declined.title).toBe('Payment failed for Jane Doe');
    expect(declined.tone).toBe('error');

    const needsAuth = describeNotification('charge_failed', {
      ...FULL_PAYLOAD,
      reason: 'authentication_required',
    });
    expect(needsAuth.title).toBe('Card needs verification for Jane Doe');
    expect(needsAuth.tone).toBe('warning');

    expect(describeNotification('charge_failed').title).toBe('Payment failed for a completed job');
  });

  it('words charge_failed for the homeowner audience (their own card, no customer name)', () => {
    const declined = describeNotification('charge_failed', {
      ...FULL_PAYLOAD,
      audience: 'homeowner',
      reason: 'declined',
    });
    expect(declined.title).toBe('Payment failed');
    expect(declined.detail).toContain("We couldn't charge your card");
    expect(declined.detail).toContain('$42.00');
    expect(declined.tone).toBe('error');

    const needsAuth = describeNotification('charge_failed', {
      ...FULL_PAYLOAD,
      audience: 'homeowner',
      reason: 'authentication_required',
    });
    expect(needsAuth.title).toBe('Confirm your payment');
    expect(needsAuth.tone).toBe('warning');
  });

  it('words charge_failed reason no_card for admin vs homeowner (T1-7)', () => {
    const admin = describeNotification('charge_failed', { ...FULL_PAYLOAD, reason: 'no_card' });
    expect(admin.title).toBe('No card on file for Jane Doe');
    expect(admin.detail).toContain('Completed job not yet paid');
    expect(admin.tone).toBe('error');

    const homeowner = describeNotification('charge_failed', {
      ...FULL_PAYLOAD,
      audience: 'homeowner',
      reason: 'no_card',
    });
    expect(homeowner.title).toBe('Add a card to pay for your cleaning');
    expect(homeowner.detail).toContain('no card on file');
    expect(homeowner.detail).toContain('$42.00');
    expect(homeowner.tone).toBe('error');

    // No customer name -> generic admin wording.
    expect(describeNotification('charge_failed', { reason: 'no_card' }).title).toBe(
      'No card on file for a completed job',
    );
  });

  it('describes tenant_payments_not_ready and cleaner_not_payable (T1-7 bail visibility)', () => {
    const tenant = describeNotification('tenant_payments_not_ready', FULL_PAYLOAD);
    expect(tenant.title).toBe('Finish Stripe setup to collect payment');
    expect(tenant.detail).toContain('cannot be charged until your Stripe account is ready');
    expect(tenant.detail).toContain('$42.00');
    expect(tenant.tone).toBe('error');

    const cleaner = describeNotification('cleaner_not_payable', FULL_PAYLOAD);
    expect(cleaner.title).toBe('Wanda Jones is not set up for payouts');
    expect(cleaner.tone).toBe('error');
    // No cleaner name -> generic.
    expect(describeNotification('cleaner_not_payable').title).toBe('Cleaner payout setup incomplete');
  });

  it('words cleaner_payout_bank_failed per audience (T3-14 payout-failure visibility)', () => {
    const cleaner = describeNotification('cleaner_payout_bank_failed', {
      ...FULL_PAYLOAD,
      audience: 'cleaner',
    });
    expect(cleaner.title).toBe('Your $42.00 payout failed');
    expect(cleaner.detail).toContain('Update your bank details');
    expect(cleaner.tone).toBe('error');

    const admin = describeNotification('cleaner_payout_bank_failed', FULL_PAYLOAD);
    expect(admin.title).toBe('Bank payout failed for Wanda Jones');
    expect(admin.detail).toContain('Stripe balance');

    // No names/amount -> generic copy, never the 'Update' fallback.
    expect(describeNotification('cleaner_payout_bank_failed', { audience: 'cleaner' }).title).toBe(
      'Your bank payout failed',
    );
    expect(describeNotification('cleaner_payout_bank_failed').title).toBe('A cleaner bank payout failed');
  });

  it('words cancellation_fee_failed by reason', () => {
    const noCard = describeNotification('cancellation_fee_failed', { ...FULL_PAYLOAD, reason: 'no_card' });
    expect(noCard.title).toBe('Cancellation fee not collected from Jane Doe');
    expect(noCard.detail).toContain('No saved card');

    const achPayer = describeNotification('cancellation_fee_failed', { reason: 'ach_payer' });
    expect(achPayer.detail).toContain('Customer pays by bank');

    const declined = describeNotification('cancellation_fee_failed', { reason: 'declined' });
    expect(declined.detail).toContain('Card declined');
  });

  it('describes self_pay_no_card and cancelled_job_refunded', () => {
    expect(describeNotification('self_pay_no_card').title).toBe('Company payment method needed');
    expect(describeNotification('self_pay_no_card').tone).toBe('error');

    const refunded = describeNotification('cancelled_job_refunded', FULL_PAYLOAD);
    expect(refunded.title).toBe('Refund issued to Jane Doe');
    expect(refunded.tone).toBe('info');
    expect(describeNotification('cancelled_job_refunded').title).toBe('Refund issued for a cancelled job');
  });

  it('describes refund_failed and clawback_blocked', () => {
    const failed = describeNotification('refund_failed', FULL_PAYLOAD);
    expect(failed.title).toBe('Refund to Jane Doe did not go through');
    expect(failed.tone).toBe('error');
    expect(describeNotification('refund_failed').title).toBe('A refund did not go through');

    const blocked = describeNotification('clawback_blocked', FULL_PAYLOAD);
    expect(blocked.title).toBe('Payout recovery needs review for Wanda Jones');
    expect(blocked.tone).toBe('warning');
    expect(describeNotification('clawback_blocked').title).toBe('Payout recovery needs review');
  });

  it('describes cleaner_counter_accepted and appointment_rescheduled (cleaner-facing)', () => {
    const accepted = describeNotification('cleaner_counter_accepted', FULL_PAYLOAD);
    expect(accepted.title).toBe('Your proposed time was accepted');
    expect(accepted.tone).toBe('success');

    const rescheduled = describeNotification('appointment_rescheduled', FULL_PAYLOAD);
    expect(rescheduled.title).toBe('A job was rescheduled');
    expect(rescheduled.tone).toBe('warning');
  });
});

describe('appointment_time_changed', () => {
  it('tells the homeowner the new time', () => {
    const d = describeNotification('appointment_time_changed', {
      audience: 'homeowner',
      scheduled_date: '2026-03-06',
      scheduled_time: '09:00',
      property_label: '124 Elm St',
    });
    expect(d.title).toContain('Your cleaning moved to');
    expect(d.tone).toBe('info');
  });
  it('falls back gracefully with no payload', () => {
    const d = describeNotification('appointment_time_changed');
    expect(d.title).toBe('Your cleaning was moved');
  });
});

describe('appointment_rescheduled variants', () => {
  it('asks for re-confirmation when requires_confirmation is true', () => {
    const d = describeNotification('appointment_rescheduled', { requires_confirmation: true, scheduled_date: '2026-03-06', scheduled_time: '09:00' });
    expect(d.detail).toContain('Please re-confirm');
    expect(d.tone).toBe('warning');
  });
  it('is a neutral FYI otherwise', () => {
    const d = describeNotification('appointment_rescheduled', { requires_confirmation: false, scheduled_date: '2026-03-06', scheduled_time: '09:00' });
    expect(d.detail ?? '').not.toContain('Please re-confirm');
    expect(d.tone).toBe('info');
  });
  it('keeps warning tone for historical rows without the flag', () => {
    const d = describeNotification('appointment_rescheduled', { scheduled_date: '2026-03-06', scheduled_time: '09:00' });
    expect(d.tone).toBe('warning');
  });
});

describe('toastVariantForTone', () => {
  it('maps tones to toast variants (warning collapses to info)', () => {
    expect(toastVariantForTone('success')).toBe('success');
    expect(toastVariantForTone('error')).toBe('error');
    expect(toastVariantForTone('info')).toBe('info');
    expect(toastVariantForTone('warning')).toBe('info');
  });
});
