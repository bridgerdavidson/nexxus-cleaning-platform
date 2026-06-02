/**
 * Single fork point for "authorize this appointment's hold".
 *
 * Self-pay appointments charge the ORG's company card (authorizeSelfPayAppointment); every other
 * appointment charges the homeowner (authorizeAppointment). Routing on `is_self_pay` here keeps
 * the three call sites — the confirm route, the manual authorize route, and the JIT authorizer
 * cron — from each repeating the branch (and the two authorizers from drifting apart).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeAppointment, type AuthorizeOutcome, type AuthorizeCode } from './authorizeAppointment';
import {
  authorizeSelfPayAppointment,
  type SelfPayAuthorizeOutcome,
  type SelfPayAuthorizeCode,
} from './authorizeSelfPayAppointment';

export type AnyAuthorizeCode = AuthorizeCode | SelfPayAuthorizeCode;
export type AnyAuthorizeOutcome = AuthorizeOutcome | SelfPayAuthorizeOutcome;

export async function authorizeAppointmentAuto(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<AnyAuthorizeOutcome> {
  const { data } = await supabase
    .from('appointments')
    .select('is_self_pay')
    .eq('id', appointmentId)
    .maybeSingle();
  const isSelfPay = (data as { is_self_pay: boolean } | null)?.is_self_pay ?? false;
  return isSelfPay
    ? authorizeSelfPayAppointment(supabase, appointmentId, actor)
    : authorizeAppointment(supabase, appointmentId, actor);
}
