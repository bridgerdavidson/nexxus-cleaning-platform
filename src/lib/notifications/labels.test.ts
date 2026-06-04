import { describe, it, expect } from 'vitest';
import { describeNotification, toastVariantForTone, type NotificationTone } from './labels';
import type { NotificationEventType } from './eventTypes';

const EVENT_TYPES: NotificationEventType[] = [
  'homeowner_request_submitted',
  'cleaner_assigned',
  'cleaner_force_assigned',
  'cleaner_accepted',
  'cleaner_declined',
  'cleaner_counter_proposed',
  'chain_exhausted',
  'cleaner_response_overdue',
];

const VALID_TONES: NotificationTone[] = ['success', 'error', 'warning', 'info'];

describe('describeNotification', () => {
  it('maps every known event type to a non-empty label, valid tone, and an icon', () => {
    for (const t of EVENT_TYPES) {
      const d = describeNotification(t);
      expect(d.label.length).toBeGreaterThan(0);
      expect(VALID_TONES).toContain(d.tone);
      expect(d.icon).toBeTruthy();
    }
  });

  it('uses no em dashes in labels (user-facing copy rule)', () => {
    for (const t of EVENT_TYPES) {
      expect(describeNotification(t).label).not.toContain('—');
    }
  });

  it('falls back safely for an unknown / future event type', () => {
    const d = describeNotification('something_new_2099');
    expect(d.label).toBe('Update');
    expect(d.tone).toBe('info');
    expect(d.icon).toBeTruthy();
  });
});

describe('toastVariantForTone', () => {
  it('maps tones to toast variants (warning collapses to info)', () => {
    expect(toastVariantForTone('success')).toBe('success');
    expect(toastVariantForTone('error')).toBe('error');
    expect(toastVariantForTone('info')).toBe('info');
    expect(toastVariantForTone('warning')).toBe('info');
  });
});
