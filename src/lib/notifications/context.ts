import type { SupabaseClient } from '@supabase/supabase-js';
import { formatUserName } from '../formatName';
import { formatPropertyLabel } from '../formatProperty';
import type { NotificationContext } from './eventTypes';

interface LoadContextArgs {
  appointmentId: string;
  /** The cleaner the message is primarily about (responder / assignee / payee). */
  cleanerId?: string | null;
  /** Reassignment target, for a decline that re-routed to another cleaner. */
  nextCleanerId?: string | null;
}

/**
 * Resolve the denormalized display fields (names, property, date/time) that get
 * spread into a notification's payload at emit time. Best-effort: any failure is
 * logged and swallowed, returning whatever partial context was gathered, so a
 * broken lookup never blocks the notification (which is itself best-effort).
 *
 * Customer name follows the app-wide self-pay convention: the homeowner's name,
 * or the organization name when the appointment is self-pay with no homeowner.
 */
export async function loadNotificationContext(
  supabaseAdmin: SupabaseClient,
  { appointmentId, cleanerId, nextCleanerId }: LoadContextArgs,
): Promise<NotificationContext> {
  const ctx: NotificationContext = {};
  try {
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select(
        'homeowner_id, property_id, is_self_pay, organization_id, scheduled_date, scheduled_time',
      )
      .eq('id', appointmentId)
      .maybeSingle();
    if (!appt) return ctx;
    const a = appt as {
      homeowner_id: string | null;
      property_id: string | null;
      is_self_pay: boolean | null;
      organization_id: string | null;
      scheduled_date: string | null;
      scheduled_time: string | null;
    };

    if (a.scheduled_date) ctx.scheduled_date = a.scheduled_date;
    if (a.scheduled_time) ctx.scheduled_time = a.scheduled_time;

    // One round trip for every user name we might need (homeowner + cleaners).
    // cleaner_profiles.id === auth user id === user_profiles.id, so a single
    // user_profiles lookup resolves cleaner names too.
    const userIds = Array.from(
      new Set(
        [a.homeowner_id, cleanerId ?? null, nextCleanerId ?? null].filter(
          Boolean,
        ) as string[],
      ),
    );
    const namesById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('user_profiles')
        .select('id, first_name, last_name')
        .in('id', userIds);
      for (const p of (profiles ?? []) as Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
      }>) {
        const name = formatUserName(p.first_name, p.last_name);
        if (name) namesById.set(p.id, name);
      }
    }

    if (cleanerId && namesById.has(cleanerId)) ctx.cleaner_name = namesById.get(cleanerId);
    if (nextCleanerId && namesById.has(nextCleanerId)) {
      ctx.next_cleaner_name = namesById.get(nextCleanerId);
    }

    if (a.homeowner_id && namesById.has(a.homeowner_id)) {
      ctx.customer_name = namesById.get(a.homeowner_id);
    } else if (a.is_self_pay && a.organization_id) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', a.organization_id)
        .maybeSingle();
      const orgName = (org as { name: string | null } | null)?.name?.trim();
      if (orgName) ctx.customer_name = orgName;
    }

    if (a.property_id) {
      const { data: prop } = await supabaseAdmin
        .from('properties')
        .select('name, address, city')
        .eq('id', a.property_id)
        .maybeSingle();
      if (prop) {
        const p = prop as {
          name: string | null;
          address: string | null;
          city: string | null;
        };
        const label = formatPropertyLabel(p.name, p.address, p.city);
        if (label) ctx.property_label = label;
      }
    }
  } catch (err) {
    console.error('loadNotificationContext failed (non-blocking):', err);
  }
  return ctx;
}
