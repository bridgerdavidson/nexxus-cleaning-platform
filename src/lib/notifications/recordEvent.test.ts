import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordNotificationEvent } from './recordEvent';

type Member = { user_id: string; role: string };

/**
 * Minimal fake of the bits of the admin client recordNotificationEvent touches:
 *   - organization_members: select().eq().in(role, roles) -> members in those roles
 *   - notification_events: insert(rows) -> captured into `inserted`
 */
function makeFakeAdmin(members: Member[]) {
  const inserted: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === 'organization_members') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: (_col: string, roles: string[]) =>
            Promise.resolve({
              data: members.filter((m) => roles.includes(m.role)).map((m) => ({ user_id: m.user_id })),
              error: null,
            }),
        };
        return builder;
      }
      if (table === 'notification_events') {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            inserted.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as unknown as SupabaseClient, inserted };
}

const MEMBERS: Member[] = [
  { user_id: 'owner-1', role: 'owner' },
  { user_id: 'admin-1', role: 'admin' },
  { user_id: 'manager-1', role: 'manager' },
  { user_id: 'cleaner-1', role: 'cleaner' },
  { user_id: 'homeowner-1', role: 'homeowner' },
];

describe('recordNotificationEvent recipient resolution', () => {
  it('fans out to recipient_roles and drops excluded users', async () => {
    const { client, inserted } = makeFakeAdmin(MEMBERS);
    await recordNotificationEvent(client, {
      event_type: 'member_joined',
      organization_id: 'org-1',
      recipient_roles: ['owner', 'admin', 'manager'],
      exclude_user_ids: ['admin-1'], // the joining admin shouldn't notify themselves
      payload: { member_name: 'Jane', member_role: 'admin' },
    });

    expect(inserted.map((r) => r.recipient_user_id).sort()).toEqual(['manager-1', 'owner-1']);
    for (const row of inserted) {
      expect(row.event_type).toBe('member_joined');
      expect(row.organization_id).toBe('org-1');
      expect(row.appointment_id).toBeNull(); // org-level event, no appointment
    }
  });

  it('defaults to owners + admins when recipient_roles is omitted', async () => {
    const { client, inserted } = makeFakeAdmin(MEMBERS);
    await recordNotificationEvent(client, {
      event_type: 'dispute_opened',
      organization_id: 'org-1',
      appointment_id: 'appt-1',
    });
    expect(inserted.map((r) => r.recipient_user_id).sort()).toEqual(['admin-1', 'owner-1']);
    expect(inserted[0].appointment_id).toBe('appt-1');
  });

  it('writes a single row for an explicit recipient_user_id', async () => {
    const { client, inserted } = makeFakeAdmin(MEMBERS);
    await recordNotificationEvent(client, {
      event_type: 'cleaner_assigned',
      organization_id: 'org-1',
      appointment_id: 'appt-1',
      recipient_user_id: 'cleaner-1',
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].recipient_user_id).toBe('cleaner-1');
  });

  it('inserts nothing when the fan-out is empty after exclusions', async () => {
    const { client, inserted } = makeFakeAdmin([{ user_id: 'owner-1', role: 'owner' }]);
    await recordNotificationEvent(client, {
      event_type: 'member_joined',
      organization_id: 'org-1',
      recipient_roles: ['owner'],
      exclude_user_ids: ['owner-1'],
    });
    expect(inserted).toHaveLength(0);
  });
});
