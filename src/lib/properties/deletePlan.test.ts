import { describe, it, expect } from 'vitest';
import { planPropertyDeletion } from './deletePlan';

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
