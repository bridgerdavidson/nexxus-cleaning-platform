-- 109_claim_appointment_for_charge_rpc.sql
-- Moves the atomic per-appointment charge claim (chargeCompletedAppointment.ts) from a PostgREST
-- `.or()`-filtered UPDATE into a raw-SQL function invoked via .rpc().
--
-- Why: the shared dev Supabase project's PostgREST intermittently fails to resolve
-- appointments.authorization_status inside an OR-filtered *mutation* (42703 "column ... does not
-- exist", in minutes-long windows), while the identical predicate as raw SQL, `.eq()`-filtered
-- mutations, and all reads work throughout (verified 2026-07-15 with interleaved non-mutating
-- probes; survived a project restart and schema reloads). Routing the claim through a function
-- sidesteps PostgREST's mutation query generation entirely, and removes the same latent risk from
-- the prod money path at charge-flow cutover.
--
-- Semantics are IDENTICAL to the previous inline query: one UPDATE, serialized by the row lock,
-- claiming the row only while it is still chargeable (NULL = the initial completion charge;
-- failed / requires_action = a recovery retry). Zero returned rows = another charge holds the
-- claim (the caller bows out with charge_in_progress). The claim RELEASE stays an inline
-- `.eq('authorization_status', 'charging')` update in chargeCompletedAppointment.ts — that filter
-- shape is unaffected by the PostgREST fault.

create or replace function public.claim_appointment_for_charge(p_appointment_id uuid)
returns setof uuid
language sql
security invoker
set search_path = public
as $$
  update public.appointments
     set authorization_status = 'charging'
   where id = p_appointment_id
     and (authorization_status is null
          or authorization_status in ('failed', 'requires_action'))
  returning id;
$$;

-- Server-only: every charge caller funnels through chargeCompletedAppointmentAuto, which always
-- runs on the service-role client (charge route, reconcile sweep, webhook re-charge).
revoke all on function public.claim_appointment_for_charge(uuid) from public;
revoke all on function public.claim_appointment_for_charge(uuid) from anon;
revoke all on function public.claim_appointment_for_charge(uuid) from authenticated;
grant execute on function public.claim_appointment_for_charge(uuid) to service_role;
