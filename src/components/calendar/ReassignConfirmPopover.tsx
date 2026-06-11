/**
 * Confirm step shown after a cross-cleaner drag on the dispatch board, before the reassign
 * fires (because reassigning returns the job to Pending and pings the new cleaner). If the
 * target cleaner already has an overlapping job, the action becomes an explicit "Assign anyway".
 */
'use client';
import React from 'react';
import { AlertTriangle, UserCheck } from 'lucide-react';

export interface PendingReassign {
  eventId: string;
  customerLabel: string;
  cleanerId: string;
  cleanerName: string;
  hasConflict: boolean;
}

export default function ReassignConfirmPopover({
  pending,
  busy = false,
  onConfirm,
  onCancel,
}: {
  pending: PendingReassign;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              pending.hasConflict ? 'bg-amber-100 text-amber-600' : 'bg-primary-100 text-primary-600'
            }`}
          >
            {pending.hasConflict ? (
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            ) : (
              <UserCheck className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Reassign to {pending.cleanerName}?
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {pending.customerLabel}&apos;s job returns to Pending and {pending.cleanerName} will be
              asked to accept it.
            </p>
            {pending.hasConflict && (
              <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-700">
                {pending.cleanerName} already has an overlapping job at that time.
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
              pending.hasConflict
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {busy ? 'Reassigning...' : pending.hasConflict ? 'Assign anyway' : 'Reassign'}
          </button>
        </div>
      </div>
    </div>
  );
}
