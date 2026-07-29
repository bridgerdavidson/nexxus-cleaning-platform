import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';
import { validateMigrationFilenames, MAX_LEGACY_VERSION } from './validateMigrationFilenames';

describe('validateMigrationFilenames', () => {
  it('accepts the frozen legacy scheme', () => {
    expect(validateMigrationFilenames(['000_baseline.sql', '116_charge_outcome_verification.sql'])).toEqual([]);
  });

  it('accepts timestamp versions', () => {
    expect(validateMigrationFilenames(['20260728194500_org_branding.sql'])).toEqual([]);
  });

  it('catches two files sharing a version, the bug that silently skipped a migration on dev', () => {
    // The real 2026-07-26 collision: one lane's file and master's file both claimed 114.
    const problems = validateMigrationFilenames([
      '114_transfer_attempt_counters.sql',
      '114_pay_requests.sql',
      '115_t1_tail_hardening.sql',
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('share version 114');
    // Both offenders are named, so the error says what to renumber.
    expect(problems[0].file).toBe('114_pay_requests.sql, 114_transfer_attempt_counters.sql');
  });

  it('rejects a new hand-numbered sequential version', () => {
    const problems = validateMigrationFilenames([`${MAX_LEGACY_VERSION + 1}_something_new.sql`]);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('frozen');
  });

  it('still allows the highest in-flight legacy version', () => {
    expect(validateMigrationFilenames([`${MAX_LEGACY_VERSION}_org_branding.sql`])).toEqual([]);
  });

  it('rejects malformed names', () => {
    const problems = validateMigrationFilenames([
      'add_column.sql', // no version
      '12_short.sql', // wrong digit count
      '117_MixedCase.sql', // not lower_snake_case
      '117_fine.txt', // not .sql
    ]);
    expect(problems).toHaveLength(4);
    // A malformed name is reported once, not also counted as a duplicate.
    expect(problems.every((p) => p.problem.includes('does not match'))).toBe(true);
  });

  it('reports every distinct collision, not just the first', () => {
    const problems = validateMigrationFilenames([
      '114_a.sql',
      '114_b.sql',
      '115_c.sql',
      '115_d.sql',
    ]);
    expect(problems).toHaveLength(2);
  });

  it('the real supabase/migrations directory is clean', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    expect(validateMigrationFilenames(files)).toEqual([]);
  });
});
