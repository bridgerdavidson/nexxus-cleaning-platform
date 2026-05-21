import { describe, it, expect } from 'vitest';
import {
  getFlowType,
  canCounterPropose,
  usesRequestState,
  homeownerCanCancel,
  shouldAutoReassignOnDecline,
} from './flowType';

describe('getFlowType', () => {
  it('returns flow_type when present', () => {
    expect(getFlowType({ flow_type: 'admin_direct' })).toBe('admin_direct');
    expect(getFlowType({ flow_type: 'homeowner_request' })).toBe('homeowner_request');
    expect(getFlowType({ flow_type: 'cleaner_availability' })).toBe('cleaner_availability');
  });

  it('falls back to homeowner_initiated=true → homeowner_request', () => {
    expect(getFlowType({ flow_type: null, homeowner_initiated: true })).toBe('homeowner_request');
  });

  it('falls back to homeowner_initiated=false → admin_direct', () => {
    expect(getFlowType({ flow_type: null, homeowner_initiated: false })).toBe('admin_direct');
  });

  it('defaults to admin_direct when both are nullish', () => {
    expect(getFlowType({})).toBe('admin_direct');
    expect(getFlowType({ flow_type: null, homeowner_initiated: null })).toBe('admin_direct');
  });
});

describe('canCounterPropose', () => {
  it('blocks counter-propose for homeowner_request', () => {
    expect(canCounterPropose({ flow_type: 'homeowner_request' })).toBe(false);
  });

  it('allows counter-propose for admin_direct', () => {
    expect(canCounterPropose({ flow_type: 'admin_direct' })).toBe(true);
  });

  it('allows counter-propose for cleaner_availability', () => {
    expect(canCounterPropose({ flow_type: 'cleaner_availability' })).toBe(true);
  });
});

describe('usesRequestState', () => {
  it('only homeowner_request uses request_state', () => {
    expect(usesRequestState({ flow_type: 'homeowner_request' })).toBe(true);
    expect(usesRequestState({ flow_type: 'admin_direct' })).toBe(false);
    expect(usesRequestState({ flow_type: 'cleaner_availability' })).toBe(false);
  });
});

describe('homeownerCanCancel', () => {
  it('only homeowner_request can be homeowner-cancelled', () => {
    expect(homeownerCanCancel({ flow_type: 'homeowner_request' })).toBe(true);
    expect(homeownerCanCancel({ flow_type: 'admin_direct' })).toBe(false);
  });
});

describe('shouldAutoReassignOnDecline', () => {
  it('returns true for all current flows', () => {
    expect(shouldAutoReassignOnDecline({ flow_type: 'homeowner_request' })).toBe(true);
    expect(shouldAutoReassignOnDecline({ flow_type: 'admin_direct' })).toBe(true);
    expect(shouldAutoReassignOnDecline({ flow_type: 'cleaner_availability' })).toBe(true);
  });
});
