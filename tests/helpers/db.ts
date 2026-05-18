import { createTestSupabaseClient } from './supabase';

/**
 * Volatile tables that integration tests can mutate. Order matters for FK constraints
 * when used as a delete sequence (children before parents).
 *
 * `organization_members`, `cleaner_profiles`, `manager_permissions`, etc. cascade via
 * `organizations` deletion, but listing them explicitly handles orphaned rows from
 * crashes mid-test.
 */
const VOLATILE_TABLES_IN_FK_DELETE_ORDER = [
  'message_attachments',
  'messages',
  'conversations',
  'cleaner_suggested_windows',
  'cleaner_suggested_times',
  'cleaner_availability_feedback',
  'cleaner_availability_windows',
  'job_photos',
  'checklist_completions',
  'checklist_line_items',
  'checklists',
  'payouts',
  'payments',
  'appointments',
  'invites',
  'properties',
  'service_types',
  'manager_permissions',
  'cleaner_profiles',
  'organization_members',
  'user_profiles',
  'organizations',
];

/**
 * Reset all volatile tables to empty. Safety net between test files.
 * Per-test isolation is achieved by giving each test its own org via `withTestOrg`,
 * not by calling this between every test.
 *
 * For auth.users (which lives in the `auth` schema and isn't directly deletable
 * via PostgREST), we rely on `supabase.auth.admin.deleteUser()` calls in fixture
 * cleanup, plus an opt-in `deleteAllTestUsers()` if needed.
 */
export async function resetDb(): Promise<void> {
  const admin = createTestSupabaseClient();
  for (const table of VOLATILE_TABLES_IN_FK_DELETE_ORDER) {
    const { error } = await admin
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error && error.code !== 'PGRST116' /* no rows */) {
      // Don't throw on missing tables — schemas vary across local/dev/prod and
      // we'd rather a missing table fail loudly via a real test than here.
      // Surface anything else.
      if (!/relation .* does not exist/i.test(error.message)) {
        throw new Error(`resetDb failed on ${table}: ${error.message}`);
      }
    }
  }
}

/**
 * Delete all auth users whose email matches the test pattern. Call sparingly —
 * `withTestOrg.cleanup()` already removes the users it created.
 */
export async function deleteAllTestUsers(emailPattern = /@test\.local$/): Promise<void> {
  const admin = createTestSupabaseClient();
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (!data?.users.length) return;
    for (const user of data.users) {
      if (user.email && emailPattern.test(user.email)) {
        await admin.auth.admin.deleteUser(user.id);
      }
    }
    if (data.users.length < 200) return;
    page += 1;
  }
  // unreachable
}
