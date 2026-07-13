import { describe, it, expect } from 'vitest';
import { planPropertyDeletion, isDeleteBlockedByPermission } from './deletePlan';

describe('planPropertyDeletion', () => {
  it('hard-deletes a never-booked property', () => {
    expect(planPropertyDeletion({ liveCount: 0, historyCount: 0 })).toEqual({
      action: 'hard-delete', liveCount: 0, historyCount: 0, needsBookingEdit: false });
  });
  it('archives (no cancel) when only history exists', () => {
    expect(planPropertyDeletion({ liveCount: 0, historyCount: 3 })).toEqual({
      action: 'archive-only', liveCount: 0, historyCount: 3, needsBookingEdit: false });
  });
  it('cancels live cleanings then archives when live exist; needs booking-edit', () => {
    expect(planPropertyDeletion({ liveCount: 2, historyCount: 5 })).toEqual({
      action: 'cancel-and-archive', liveCount: 2, historyCount: 5, needsBookingEdit: true });
  });
  it('cancel-and-archive even with zero history when live exist', () => {
    expect(planPropertyDeletion({ liveCount: 1, historyCount: 0 })).toEqual({
      action: 'cancel-and-archive', liveCount: 1, historyCount: 0, needsBookingEdit: true });
  });
});

describe('isDeleteBlockedByPermission', () => {
  it('never blocks a privileged owner/admin, even for cancel-and-archive', () => {
    // Regression: owner/admin have no manager_permissions row, so the raw flag
    // reads false. Privilege must still un-block them.
    expect(isDeleteBlockedByPermission('cancel-and-archive', { privileged: true, canEditBookingsFlag: false })).toBe(false);
  });
  it('blocks a manager without booking-edit on cancel-and-archive', () => {
    expect(isDeleteBlockedByPermission('cancel-and-archive', { privileged: false, canEditBookingsFlag: false })).toBe(true);
  });
  it('does not block a manager who has booking-edit on cancel-and-archive', () => {
    expect(isDeleteBlockedByPermission('cancel-and-archive', { privileged: false, canEditBookingsFlag: true })).toBe(false);
  });
  it('never blocks hard-delete or archive-only, regardless of permission', () => {
    expect(isDeleteBlockedByPermission('hard-delete', { privileged: false, canEditBookingsFlag: false })).toBe(false);
    expect(isDeleteBlockedByPermission('archive-only', { privileged: false, canEditBookingsFlag: false })).toBe(false);
  });
  it('is not blocked when there is no plan yet', () => {
    expect(isDeleteBlockedByPermission(null, { privileged: false, canEditBookingsFlag: false })).toBe(false);
  });
});
