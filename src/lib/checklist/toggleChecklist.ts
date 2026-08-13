/**
 * Cache-coordination logic for toggling checklist item completions.
 *
 * Extracted from useToggleChecklistItem (src/hooks/useCleanerData.ts) so the
 * optimistic-update / refetch interplay is unit-testable headlessly with a
 * QueryClient + MutationObserver — no React renderer needed. The hook injects
 * the actual Supabase writer; this module owns everything cache-side.
 */

import type { QueryClient, UseMutationOptions } from '@tanstack/react-query';
import { keys } from '../queryKeys';

export interface ToggleChecklistVars {
  appointmentId: string;
  lineItemId: string;
  done: boolean;
}

interface ToggleContext {
  queryKey: readonly unknown[];
  /** Whether this line item was ticked before this mutation's optimistic write. */
  hadItem: boolean;
}

export const CHECKLIST_TOGGLE_MUTATION_KEY = ['checklist-toggle'] as const;

/**
 * Build the useMutation options for a checklist item toggle.
 *
 * @param qc          the app QueryClient
 * @param writeToggle persists the toggle (upsert on done, delete on undone)
 */
export function checklistToggleMutationOptions(
  qc: QueryClient,
  writeToggle: (vars: ToggleChecklistVars) => Promise<void>,
): UseMutationOptions<void, Error, ToggleChecklistVars, ToggleContext> {
  return {
    mutationKey: CHECKLIST_TOGGLE_MUTATION_KEY,
    mutationFn: writeToggle,
    onMutate: async ({ appointmentId, lineItemId, done }) => {
      const queryKey = keys.appointments.checklistCompletions(appointmentId);
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Set<string>>(queryKey);
      qc.setQueryData<Set<string>>(queryKey, (old) => {
        const next = new Set(old ?? []);
        if (done) next.add(lineItemId);
        else next.delete(lineItemId);
        return next;
      });
      return { hadItem: previous?.has(lineItemId) ?? false, queryKey };
    },
    // Revert ONLY this mutation's item. Restoring a whole-Set snapshot here
    // would wipe the optimistic ticks of any toggles fired after this one.
    onError: (_err, { lineItemId }, ctx) => {
      if (!ctx) return;
      qc.setQueryData<Set<string>>(ctx.queryKey, (old) => {
        const next = new Set(old ?? []);
        if (ctx.hadItem) next.add(lineItemId);
        else next.delete(lineItemId);
        return next;
      });
    },
    // Refetch only when this is the LAST in-flight toggle for the appointment.
    // Invalidating on every settle races the refetch against still-pending
    // writes: the response snapshots the server before those writes commit and
    // visually unchecks them when it lands (the rapid-tap bug).
    onSettled: (_data, _err, { appointmentId }) => {
      const pendingForAppointment = qc.isMutating({
        mutationKey: CHECKLIST_TOGGLE_MUTATION_KEY,
        predicate: (m) =>
          (m.state.variables as ToggleChecklistVars | undefined)?.appointmentId ===
          appointmentId,
      });
      if (pendingForAppointment === 1) {
        qc.invalidateQueries({
          queryKey: keys.appointments.checklistCompletions(appointmentId),
        });
      }
    },
  };
}
