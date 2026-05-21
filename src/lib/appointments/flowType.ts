export type AppointmentFlowType =
  | 'homeowner_request'
  | 'admin_direct'
  | 'cleaner_availability';

interface FlowInput {
  flow_type?: AppointmentFlowType | null;
  /** Transitional fallback while `flow_type` rolls out everywhere. */
  homeowner_initiated?: boolean | null;
}

/**
 * The canonical accessor. Falls back to the legacy boolean until migration 062
 * is fully rolled out across all environments and the column is dropped.
 */
export function getFlowType(apt: FlowInput): AppointmentFlowType {
  if (apt.flow_type) return apt.flow_type;
  return apt.homeowner_initiated ? 'homeowner_request' : 'admin_direct';
}

/**
 * The cleaner can counter-propose alternative times?
 *
 * False for homeowner_request — the homeowner already offered up to 3 slots,
 * so there's no haggling. True for everything else (admin-direct and the
 * future cleaner_availability flow).
 */
export function canCounterPropose(apt: FlowInput): boolean {
  return getFlowType(apt) !== 'homeowner_request';
}

/**
 * The appointment uses the `request_state` state machine
 * (awaiting_admin → routing → needs_admin_attention → completed)?
 *
 * Only homeowner_request does today. Admin-direct + cleaner_availability rely
 * on `cleaner_confirmation_status` alone.
 */
export function usesRequestState(apt: FlowInput): boolean {
  return getFlowType(apt) === 'homeowner_request';
}

/**
 * The homeowner can cancel this appointment before it's confirmed?
 *
 * Only their own requests. Admin-direct and cleaner_availability are admin
 * cancellations.
 */
export function homeownerCanCancel(apt: FlowInput): boolean {
  return getFlowType(apt) === 'homeowner_request';
}

/**
 * On cleaner decline, auto-reassign to the next cleaner in the routing chain?
 *
 * All current flows yes — kept explicit so the future cleaner_availability
 * flow can opt out (admin force-assigns directly without a routing chain).
 */
export function shouldAutoReassignOnDecline(_apt: FlowInput): boolean {
  return true;
}
