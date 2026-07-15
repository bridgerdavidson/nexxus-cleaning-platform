import { describe, it, expect } from 'vitest';
import { derivePaymentSectionState, mapChargeResponse } from './paymentSectionState';

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

describe('derivePaymentSectionState precedence conflicts', () => {
  const base = { authorizationStatus: null, paymentStatus: null, isSelfPay: false, jobCompleted: false, hasCard: true };
  it('failed authorization wins over paid payment status', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'failed', paymentStatus: 'paid' })).toBe('failed');
  });
  it('requires_action authorization wins over processing payment status', () => {
    expect(derivePaymentSectionState({ ...base, authorizationStatus: 'requires_action', paymentStatus: 'processing' })).toBe('requires_action');
  });
});
