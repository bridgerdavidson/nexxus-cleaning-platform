import type { SupabaseClient } from '@supabase/supabase-js';
import { computeResponseDeadlineISO } from '../computeResponseDeadline';
import { formatUserName } from '../formatName';
import {
  rankCleanersByMultiSlotCoverage,
  type CleanerLike,
  type CleanerMetrics,
  type SlotCandidate,
} from '../cleanerAvailability';
import type { ScheduleAppointment } from '../appointmentConflicts';

const MAX_ATTEMPTS = 3;

export type AdvanceOutcome =
  | { kind: 'noop'; reason: string }
  | { kind: 'assigned'; cleanerId: string; cleanerName?: string; attemptIndex: number }
  | { kind: 'escalated'; reason: 'chain_exhausted' | 'no_cleaners_available' };

interface AdvanceRoutingArgs {
  appointmentId: string;
  organizationId: string;
  supabaseAdmin: SupabaseClient;
}

interface RoutingLogRow {
  id: string;
  cleaner_id: string;
  attempt_index: number;
  response: 'pending' | 'accepted' | 'declined' | 'expired';
  deadline_at: string;
}

interface AppointmentRow {
  id: string;
  organization_id: string;
  homeowner_initiated: boolean | null;
  flow_type: 'homeowner_request' | 'admin_direct' | 'cleaner_availability' | null;
  property_id: string;
  service_type_id: string;
  duration_minutes: number;
  cleaner_id: string | null;
  request_state: string | null;
  scheduled_date: string;
  scheduled_time: string;
}

interface SlotRow {
  slot_index: number;
  scheduled_date: string;
  scheduled_time: string;
}

interface CleanerProfileRow {
  id: string;
  user_profile: {
    first_name: string | null;
    last_name: string | null;
  } | null;
}

/**
 * Advance a homeowner-initiated appointment to the next cleaner in the chain.
 *
 * Called from three places:
 *   - The cleaner-declines path in /api/appointments/confirm (POST).
 *   - The bulk auto-defer route, for each expired routing_log row.
 *   - The single-appointment auto-defer route, called by the cleaner-dashboard
 *     visit hook.
 *
 * Idempotent: if there is already a pending routing_log row, this is a no-op
 * (the assign-cleaner route is responsible for initial assignment).
 */
export async function advanceAppointmentRouting({
  appointmentId,
  organizationId,
  supabaseAdmin,
}: AdvanceRoutingArgs): Promise<AdvanceOutcome> {
  const { data: appt, error: apptErr } = await supabaseAdmin
    .from('appointments')
    .select(
      'id, organization_id, homeowner_initiated, flow_type, property_id, service_type_id, duration_minutes, cleaner_id, request_state, scheduled_date, scheduled_time',
    )
    .eq('id', appointmentId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (apptErr || !appt) {
    return { kind: 'noop', reason: 'appointment_not_found' };
  }
  const appointment = appt as unknown as AppointmentRow;

  const { data: logRows } = await supabaseAdmin
    .from('appointment_routing_log')
    .select('id, cleaner_id, attempt_index, response, deadline_at')
    .eq('appointment_id', appointmentId)
    .order('attempt_index', { ascending: true });
  const log = (logRows ?? []) as RoutingLogRow[];

  // If there is already a pending row, do nothing — only the cleaner's own
  // response or an explicit timeout-sweep advances the chain.
  if (log.some((r) => r.response === 'pending')) {
    return { kind: 'noop', reason: 'pending_row_exists' };
  }

  const nextAttempt = (log[log.length - 1]?.attempt_index ?? 0) + 1;
  if (nextAttempt > MAX_ATTEMPTS) {
    await escalate(appointmentId, supabaseAdmin);
    return { kind: 'escalated', reason: 'chain_exhausted' };
  }

  const excludeIds = log.map((r) => r.cleaner_id);

  // Pull active cleaners in this org.
  const { data: cleanerRows } = await supabaseAdmin
    .from('cleaner_profiles')
    .select('id, user_profile:user_profiles!id(first_name, last_name)')
    .eq('organization_id', organizationId)
    .eq('is_available', true);
  const cleaners = ((cleanerRows ?? []) as unknown as CleanerProfileRow[]).map((row) => ({
    id: row.id,
    user_profile: row.user_profile && !Array.isArray(row.user_profile)
      ? row.user_profile
      : Array.isArray(row.user_profile)
        ? row.user_profile[0]
        : null,
  })) as CleanerLike[];

  if (cleaners.length === 0) {
    await escalate(appointmentId, supabaseAdmin);
    return { kind: 'escalated', reason: 'no_cleaners_available' };
  }

  // Offered slots. Homeowner requests + admin-direct with alternates have
  // rows in `appointment_requested_slots`; admin-direct without alternates
  // falls back to the appointment's single scheduled slot.
  const { data: slotRows } = await supabaseAdmin
    .from('appointment_requested_slots')
    .select('slot_index, scheduled_date, scheduled_time')
    .eq('appointment_id', appointmentId)
    .order('slot_index', { ascending: true });
  let slots: SlotCandidate[] = ((slotRows ?? []) as SlotRow[]).map((s) => ({
    date: s.scheduled_date,
    time: s.scheduled_time,
  }));
  if (slots.length === 0) {
    slots = [
      { date: appointment.scheduled_date, time: appointment.scheduled_time },
    ];
  }

  const allDates = Array.from(new Set(slots.map((s) => s.date)));
  const candidateIds = cleaners.map((c) => c.id);
  const { data: scheduleRows } = await supabaseAdmin
    .from('appointments')
    .select('id, cleaner_id, status, scheduled_date, scheduled_time, duration_minutes')
    .in('cleaner_id', candidateIds)
    .in('scheduled_date', allDates);
  const schedulesByCleaner: Record<string, ScheduleAppointment[]> = {};
  for (const row of (scheduleRows ?? []) as Array<ScheduleAppointment & { cleaner_id: string | null }>) {
    if (!row.cleaner_id) continue;
    const list = schedulesByCleaner[row.cleaner_id] ?? [];
    list.push(row);
    schedulesByCleaner[row.cleaner_id] = list;
  }

  // Metrics — acceptance rate over last 60 days from routing_log, plus
  // last-worked-this-property from appointments.
  const metrics = await buildMetrics(
    candidateIds,
    appointment.property_id,
    supabaseAdmin,
  );

  const ranked = rankCleanersByMultiSlotCoverage(
    cleaners,
    schedulesByCleaner,
    slots,
    appointment.duration_minutes,
    metrics,
    excludeIds,
  );
  if (ranked.length === 0) {
    await escalate(appointmentId, supabaseAdmin);
    return { kind: 'escalated', reason: 'no_cleaners_available' };
  }

  const picked = ranked[0].cleaner;
  const pickedName = formatUserName(
    picked.user_profile?.first_name,
    picked.user_profile?.last_name,
  );
  const primary = slots[0];
  const deadline = computeResponseDeadlineISO(primary.date, primary.time);

  const { error: insertErr } = await supabaseAdmin
    .from('appointment_routing_log')
    .insert({
      appointment_id: appointmentId,
      cleaner_id: picked.id,
      attempt_index: nextAttempt,
      deadline_at: deadline,
    });
  if (insertErr) {
    return { kind: 'noop', reason: `insert_routing_log_failed:${insertErr.message}` };
  }

  await supabaseAdmin
    .from('appointments')
    .update({
      cleaner_id: picked.id,
      cleaner_confirmation_status: 'awaiting',
      response_deadline: deadline,
      request_state: 'routing',
    })
    .eq('id', appointmentId);

  return {
    kind: 'assigned',
    cleanerId: picked.id,
    cleanerName: pickedName || undefined,
    attemptIndex: nextAttempt,
  };
}

async function escalate(
  appointmentId: string,
  supabaseAdmin: SupabaseClient,
): Promise<void> {
  // Both flows escalate identically: cleaner_id=null +
  // cleaner_confirmation_status='rejected' is the canonical "all cleaners
  // declined" state, plus request_state='needs_admin_attention' for
  // analytics/state-machine consistency. The unified ActionRequiredSection
  // renders this with a force-assign + call-homeowner variant.
  await supabaseAdmin
    .from('appointments')
    .update({
      request_state: 'needs_admin_attention',
      cleaner_id: null,
      response_deadline: null,
      cleaner_confirmation_status: 'rejected',
    })
    .eq('id', appointmentId);
}

async function buildMetrics(
  cleanerIds: string[],
  propertyId: string,
  supabaseAdmin: SupabaseClient,
): Promise<Record<string, CleanerMetrics>> {
  if (cleanerIds.length === 0) return {};

  const { data: lastWorkedRows } = await supabaseAdmin
    .from('appointments')
    .select('cleaner_id, scheduled_date')
    .in('cleaner_id', cleanerIds)
    .eq('property_id', propertyId)
    .order('scheduled_date', { ascending: false });

  const mostRecent: Record<string, string> = {};
  for (const row of (lastWorkedRows ?? []) as Array<{ cleaner_id: string; scheduled_date: string }>) {
    if (!mostRecent[row.cleaner_id]) {
      mostRecent[row.cleaner_id] = row.scheduled_date;
    }
  }

  const result: Record<string, CleanerMetrics> = {};
  const today = new Date();
  for (const id of cleanerIds) {
    let lastWorkedDaysAgo: number | null = null;
    const dateStr = mostRecent[id];
    if (dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      lastWorkedDaysAgo = Math.max(
        0,
        Math.floor((today.getTime() - dt.getTime()) / (24 * 60 * 60 * 1000)),
      );
    }
    result[id] = { lastWorkedDaysAgo };
  }
  return result;
}
