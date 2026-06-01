import { describe, it, expect } from 'vitest';
import {
  classifyOrgLoadResult,
  isRetryableOutcome,
  resolveTerminalOrgState,
} from './orgLoad';

describe('classifyOrgLoadResult', () => {
  it('classifies a row-bearing result as "rows"', () => {
    expect(classifyOrgLoadResult({ error: null, data: [{ organization_id: 'o1' }] })).toBe('rows');
  });

  it('classifies an error as "error" even if data is present', () => {
    expect(
      classifyOrgLoadResult({ error: { code: 'PGRST301' }, data: [{ organization_id: 'o1' }] }),
    ).toBe('error');
  });

  it('classifies an empty array as "empty"', () => {
    expect(classifyOrgLoadResult({ error: null, data: [] })).toBe('empty');
  });

  it('classifies null/undefined data as "empty"', () => {
    expect(classifyOrgLoadResult({ error: null, data: null })).toBe('empty');
    expect(classifyOrgLoadResult({ error: null, data: undefined })).toBe('empty');
  });
});

describe('isRetryableOutcome', () => {
  it('treats both error and empty as retryable (a member can get 0 rows mid-rotation)', () => {
    expect(isRetryableOutcome('error')).toBe(true);
    expect(isRetryableOutcome('empty')).toBe(true);
  });

  it('does not retry a successful row result', () => {
    expect(isRetryableOutcome('rows')).toBe(false);
  });
});

describe('resolveTerminalOrgState', () => {
  it('never wipes a working org on a transient empty result (the core regression)', () => {
    expect(resolveTerminalOrgState('empty', /* hadOrg */ true)).toEqual({
      status: 'loaded',
      clearOrg: false,
    });
  });

  it('never wipes a working org on a transient error', () => {
    expect(resolveTerminalOrgState('error', /* hadOrg */ true)).toEqual({
      status: 'loaded',
      clearOrg: false,
    });
  });

  it('resolves a first-ever load with no rows to confirmed no-org (and clears)', () => {
    expect(resolveTerminalOrgState('empty', /* hadOrg */ false)).toEqual({
      status: 'no-org',
      clearOrg: true,
    });
  });

  it('resolves a first-ever load that errored to an error state (kept null, retry UI)', () => {
    expect(resolveTerminalOrgState('error', /* hadOrg */ false)).toEqual({
      status: 'error',
      clearOrg: false,
    });
  });
});
