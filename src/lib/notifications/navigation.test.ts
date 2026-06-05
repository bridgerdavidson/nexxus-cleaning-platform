import { describe, it, expect } from 'vitest';
import { notificationTab, type NotificationRole } from './navigation';

describe('notificationTab', () => {
  it('sends a cleaner to jobs, and their payout to earnings', () => {
    expect(notificationTab('cleaner_assigned', 'cleaner')).toBe('jobs');
    expect(notificationTab('cleaner_force_assigned', 'cleaner')).toBe('jobs');
    expect(notificationTab('cleaner_paid', 'cleaner')).toBe('earnings');
  });

  it('always sends a homeowner home', () => {
    expect(notificationTab('cleaner_accepted', 'homeowner')).toBe('home');
    expect(notificationTab('job_completed', 'homeowner')).toBe('home');
  });

  it('routes admin/manager action-needed events to the overview (home)', () => {
    const actionNeeded = [
      'homeowner_request_submitted',
      'cleaner_declined',
      'chain_exhausted',
      'cleaner_counter_proposed',
      'cleaner_response_overdue',
    ];
    for (const role of ['admin', 'manager'] as NotificationRole[]) {
      for (const e of actionNeeded) {
        expect(notificationTab(e, role)).toBe('home');
      }
    }
  });

  it('routes admin settled/lifecycle events to bookings and money events to payments', () => {
    for (const role of ['admin', 'manager'] as NotificationRole[]) {
      expect(notificationTab('cleaner_accepted', role)).toBe('bookings');
      expect(notificationTab('job_started', role)).toBe('bookings');
      expect(notificationTab('job_completed', role)).toBe('bookings');
      expect(notificationTab('dispute_opened', role)).toBe('payments');
      expect(notificationTab('authorization_failed', role)).toBe('payments');
    }
  });
});
