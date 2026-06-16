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
  'job_started',
  'job_completed',
  'dispute_opened',
  'authorization_failed',
  'authentication_required',
  'charge_failed',
  'cancellation_fee_failed',
  'self_pay_no_card',
  'cancelled_job_refunded',
  'refund_failed',
  'clawback_blocked',
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

describe('toastVariantForTone', () => {
  it('maps tones to toast variants (warning collapses to info)', () => {
    expect(toastVariantForTone('success')).toBe('success');
    expect(toastVariantForTone('error')).toBe('error');
    expect(toastVariantForTone('info')).toBe('info');
    expect(toastVariantForTone('warning')).toBe('info');
  });
});
