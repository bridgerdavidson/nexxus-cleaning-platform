/**
 * Migration filename integrity.
 *
 * The Supabase CLI identifies a migration by its VERSION PREFIX ALONE — never by
 * filename or content. Two different files sharing a version silently alias: whichever
 * lands first wins, the second is recorded as "already applied" and never runs, and
 * `db push` cheerfully reports "Remote database is up to date" while the schema is wrong.
 *
 * That is not hypothetical. On 2026-07-26 a feature branch applied `114_pay_requests.sql`
 * to the shared dev database. Master's `114_transfer_attempt_counters.sql` was therefore
 * skipped forever after, so dev silently lost `payouts.transfer_attempt` and
 * `payments.tenant_transfer_attempt` for two days until a preview broke for an apparently
 * unrelated reason. The same collision would have merged to master without a git conflict
 * (different filenames), which puts production in range of the same failure.
 *
 * Sequential numbering is what makes collisions likely: every parallel lane reaches for the
 * next integer at the same time, then renumbers, and renumbering after a branch has already
 * pushed to dev is what strands versions in its ledger and blocks every other branch.
 *
 * So: legacy three-digit versions are frozen, and every NEW migration uses the CLI's
 * timestamp form (`npx supabase migration new <name>` → `20260728194500_name.sql`), which
 * cannot collide. Timestamps sort after the legacy numbers lexicographically ("121" < "2026…"),
 * so ordering is preserved.
 */

/** Highest legacy three-digit version. Frozen: 117-121 are in flight on unmerged branches. */
export const MAX_LEGACY_VERSION = 121;

/** `123_name.sql` (legacy, frozen) or `20260728194500_name.sql` (timestamp, required for new). */
const FILENAME = /^(\d{3}|\d{14})_[a-z0-9_]+\.sql$/;

export interface MigrationProblem {
  file: string;
  problem: string;
}

/**
 * Validate a list of migration filenames (basenames, in any order).
 * Returns one entry per problem found; an empty array means the directory is healthy.
 */
export function validateMigrationFilenames(files: string[]): MigrationProblem[] {
  const problems: MigrationProblem[] = [];
  const byVersion = new Map<string, string[]>();

  for (const file of files) {
    const match = FILENAME.exec(file);
    if (!match) {
      problems.push({
        file,
        problem:
          'does not match <version>_<lower_snake_name>.sql. New migrations must be created with ' +
          '`npx supabase migration new <name>` so they get a timestamp version.',
      });
      continue;
    }

    const version = match[1];
    byVersion.set(version, [...(byVersion.get(version) ?? []), file]);

    // A new three-digit version means someone hand-numbered instead of using the CLI, which
    // is exactly how two lanes end up on the same number.
    if (version.length === 3 && Number(version) > MAX_LEGACY_VERSION) {
      problems.push({
        file,
        problem:
          `uses a new sequential version (${version}). The three-digit scheme is frozen at ` +
          `${MAX_LEGACY_VERSION}. Create migrations with \`npx supabase migration new <name>\` ` +
          'so they get a collision-proof timestamp version.',
      });
    }
  }

  for (const [version, dupes] of byVersion) {
    if (dupes.length > 1) {
      problems.push({
        file: [...dupes].sort().join(', '),
        problem:
          `share version ${version}. The Supabase CLI keys on the version alone, so only one of ` +
          'these will ever run and the other is silently recorded as applied. Renumber before merging.',
      });
    }
  }

  return problems;
}
