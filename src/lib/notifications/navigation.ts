/**
 * Where a notification click should land. The appointment drawer overlays at the
 * dashboard-page level (so it opens regardless of tab); this just picks the best
 * *background* tab for context. Action-needed events go to the admin Overview
 * (where the Action Required section lives), settled/lifecycle events to the
 * list, and money events to Payments. Pure + unit-tested.
 */
export type NotificationRole = 'admin' | 'manager' | 'cleaner' | 'homeowner';

export function notificationTab(eventType: string, role: NotificationRole): string {
  if (role === 'cleaner') {
    return eventType === 'cleaner_paid' ? 'earnings' : 'jobs';
  }
  if (role === 'homeowner') {
    return 'home';
  }
  // admin / manager
  switch (eventType) {
    case 'cleaner_accepted':
    case 'job_started':
    case 'job_completed':
      return 'bookings';
    case 'dispute_opened':
    case 'authorization_failed':
    case 'authentication_required':
    case 'charge_failed':
    case 'cancellation_fee_failed':
    case 'self_pay_no_card':
    case 'cancelled_job_refunded':
    case 'refund_failed':
    case 'clawback_blocked':
      return 'payments';
    default:
      // homeowner_request_submitted, cleaner_declined, chain_exhausted,
      // cleaner_counter_proposed, cleaner_response_overdue -> Overview.
      return 'home';
  }
}
