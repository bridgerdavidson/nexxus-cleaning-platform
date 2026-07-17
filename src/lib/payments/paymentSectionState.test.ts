import { describe, it, expect } from 'vitest';
import {
  derivePaymentSectionState,
  homeownerPaymentSectionState,
  mapChargeResponse,
} from './paymentSectionState';

describe('derivePaymentSectionState', () => {
  const base = { authorizationStatus: null, paymentStatus: null, isSelfPay: false, jobCompleted: false, hasCard: true };
  it('self-pay wins over everything', () => {
    expect(derivePaymentSectionState({ ...base, isSelfPay: true, authorizationStatus: 'failed' })).toBe('self_pay');
  });
  it('failed', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'failed', jobCompleted: true })).toBe('failed');
  });
  it('requires_action', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'requires_action', jobCompleted: true })).toBe('requires_action');
  });
  it('paid', () => {
    expect(derivePaymentSectionState({ ...base, paymentStatus: 'paid', authorizationStatus: 'captured' })).toBe('paid');
  });
  it('processing', () => {
    expect(derivePaymentSectionState({ ...base, paymentStatus: 'processing' })).toBe('processing');
  });
  it('no card', () => {
    expect(derivePaymentSectionState({ ...base, hasCard: false })).toBe('no_card');
  });
  it('before charge (card on file, not completed)', () => {
    expect(derivePaymentSectionState({ ...base, hasCard: true, jobCompleted: false })).toBe('before_charge');
  });
});

describe('mapChargeResponse', () => {
  it('charged -> success/paid', () => {
    expect(mapChargeResponse('charged', 200)).toEqual({ outcome: 'charged', badgeTone: 'success', stayFailed: false });
  });
  it('processing -> info', () => {
    expect(mapChargeResponse('processing', 200)).toEqual({ outcome: 'processing', badgeTone: 'info', stayFailed: false });
  });
  it('requires_action -> caution, not paid', () => {
    expect(mapChargeResponse('requires_action', 402)).toEqual({ outcome: 'requires_action', badgeTone: 'caution', stayFailed: false });
  });
  it('declined -> stays failed', () => {
    expect(mapChargeResponse('declined', 402)).toEqual({ outcome: 'declined', badgeTone: 'critical', stayFailed: true });
  });
  it('precondition 409 -> stays failed', () => {
    expect(mapChargeResponse('no_card', 409)).toEqual({ outcome: 'precondition', badgeTone: 'critical', stayFailed: true });
  });
  it('failed 502 (genuine Stripe/system failure) -> declined, not precondition', () => {
    expect(mapChargeResponse('failed', 502)).toEqual({ outcome: 'declined', badgeTone: 'critical', stayFailed: true });
  });
  it('error 500 (genuine system failure) -> declined, not precondition', () => {
    expect(mapChargeResponse('error', 500)).toEqual({ outcome: 'declined', badgeTone: 'critical', stayFailed: true });
  });
});

describe('homeownerPaymentSectionState (column -> arg wiring)', () => {
  it('passes is_self_pay through so a company-funded cleaning short-circuits to self_pay', () => {
    // Regression guard: the component used to hardcode isSelfPay:false, so a
    // comped self-pay row with a failed auth wrongly rendered "Payment failed".
    expect(
      homeownerPaymentSectionState({
        is_self_pay: true,
        authorization_status: 'failed',
        payment_method_id: 'pm_1',
        status: 'completed',
      }),
    ).toBe('self_pay');
  });
  it('a non-self-pay failed charge still reads as failed', () => {
    expect(
      homeownerPaymentSectionState({
        is_self_pay: false,
        authorization_status: 'failed',
        payment_method_id: 'pm_1',
        status: 'completed',
      }),
    ).toBe('failed');
  });
  it('treats missing/null is_self_pay as not self-pay', () => {
    expect(
      homeownerPaymentSectionState({ payment_method_id: 'pm_1', status: 'scheduled' }),
    ).toBe('before_charge');
    expect(
      homeownerPaymentSectionState({ is_self_pay: null, payment_method_id: null }),
    ).toBe('no_card');
  });
});

describe('derivePaymentSectionState precedence conflicts', () => {
  const base = { authorizationStatus: null, paymentStatus: null, isSelfPay: false, jobCompleted: false, hasCard: true };
  it('failed authorization wins over paid payment status', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'failed', paymentStatus: 'paid' })).toBe('failed');
  });
  it('requires_action authorization wins over processing payment status', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'requires_action', paymentStatus: 'processing' })).toBe('requires_action');
  });
});
