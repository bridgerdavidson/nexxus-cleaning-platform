// ==========================================
// DATABASE TYPES - MUST MATCH DB SCHEMA
// See DB-SCHEMA-REFERENCE.md for details
// ==========================================

// ENUMS (must match database)
export type UserRole = 'homeowner' | 'cleaner' | 'admin' | 'manager';
export type OrgRole = 'owner' | 'admin' | 'manager' | 'cleaner' | 'homeowner';
export type AppointmentStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
// ServiceType is now a string to allow custom service types (no longer an enum)
// Common values: 'regular', 'deep', 'move_out', 'custom' but users can add their own
export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'refunded';
export type PaymentType = 'revenue' | 'expense' | 'refund';
export type PaymentMethod = 'card' | 'ach' | 'manual';
export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'failed' | 'reversed' | 'bank_paid';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled';
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly';
export type JobProgress = 'not_started' | 'before_photos' | 'checklist' | 'after_photos' | 'completed';
export type CleanerConfirmationStatus = 'awaiting' | 'approved' | 'rejected';
// Sidecar lifecycle for homeowner-initiated booking requests. NULL on admin
// direct-book appointments. See migration 059.
export type AppointmentRequestState =
  | 'awaiting_admin'
  | 'routing'
  | 'needs_admin_attention'
  | 'completed';
// How the appointment came into existence. Drives flow-specific behavior
// (counter-propose allowed? request_state state machine?) — see
// src/lib/appointments/flowType.ts.
export type AppointmentFlowType =
  | 'homeowner_request'
  | 'admin_direct'
  | 'cleaner_availability';
export type RoutingLogResponse = 'pending' | 'accepted' | 'declined' | 'expired';
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'creating' | 'superseded' | 'failed' | 'expired';
// Display status mirrors InviteStatus 1:1 now that 'expired' is a real DB value;
// kept as a separate name for callers that previously folded computed expiry in.
export type InviteDisplayStatus = InviteStatus;

// INVITES
export interface Invite {
  id: string;
  organization_id: string;
  email: string;
  role: 'cleaner' | 'manager' | 'admin' | 'homeowner';
  status: InviteStatus;
  sent_at: string | null;
  accepted_at: string | null;
  invited_by: string;
  expiration_date: string;
  opened_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined / derived
  invited_by_profile?: {
    first_name: string | null;
    last_name: string | null;
    email: string;
  } | null;
  is_expired?: boolean;
}

// USER PROFILES
export interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: UserRole;
  avatar_url: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
  welcome_seen_at?: string | null;
  setup_checklist_dismissed_at?: string | null;
}

// ORGANIZATIONS
export interface Organization {
  id: string;
  name: string;
  logo_url?: string | null;
  /** One hex the tenant picks; null falls back to the Nexxus brand. See docs/white-label-branding.md. */
  brand_color?: string | null;
  /** Square-ish mark: collapsed rail, mobile nav, favicon, email. Null renders an initials monogram. */
  logo_icon_url?: string | null;
  /** Lockup or wordmark: expanded rail, drawer header. Null renders the icon plus the org name. */
  logo_full_url?: string | null;
  brand_updated_at?: string | null;
  created_at: string;
  created_by: string | null;
  // Stripe tenant Connect (merchant of record) — added in migration 065_stripe_restructure.
  stripe_connect_account_id?: string | null;
  stripe_connect_charges_enabled?: boolean;
  stripe_connect_payouts_enabled?: boolean;
  stripe_connect_details_submitted?: boolean;
  stripe_connect_requirements_due?: string[];
  stripe_connect_onboarded_at?: string | null;
  // SaaS billing (the org paying Nexxus) — distinct from the Connect account above.
  stripe_customer_id?: string | null;
  subscription_status?: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled';
  subscription_id?: string | null;
  subscription_current_period_end?: string | null;
  // Platform fee + per-org policy.
  platform_fee_bps?: number; // basis points (100 = 1%), default 0
  default_payout_model?: 'percentage_contractor' | 'hourly_external';
  cancellation_window_hours?: number; // default 24
  cancellation_fee_type?: 'none' | 'flat' | 'percent';
  cancellation_fee_value?: number; // dollars (flat) or percent (percent)
  billing_email?: string | null;
  // Active-job photo gate — added in migration 095.
  require_job_photos: boolean;
  // What the assigned cleaner sees on the Complete sheet — added in migration 096.
  //   'full'        -> full breakdown (customer charge + cut).
  //   'payout_only' -> only the cleaner's cut (no customer charge, no percentage).
  cleaner_pay_display: 'full' | 'payout_only';
  // Onboarding wizard (R4-C) — added in migration 101.
  setup_checklist_dismissed_at?: string | null;
  payout_configured_at?: string | null;
  hours_policy_configured_at?: string | null;
}

// ORGANIZATION MEMBERS
export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

// CLEANER PROFILES
export interface CleanerProfile {
  id: string; // References user_profiles(id) - NOT a separate user_id field!
  organization_id: string | null;
  bio: string | null;
  experience_years: number | null;
  hourly_rate: number | null;
  rating: number; // numeric(3,2), default 0.00
  total_jobs: number; // default 0
  is_available: boolean; // default true
  background_check_verified: boolean; // default false
  insurance_verified: boolean; // default false
  stripe_connect_account_id: string | null;
  stripe_connect_onboarding_complete: boolean; // default false
  payout_percent: number; // numeric(5,2), default 0.00
  created_at: string;
  updated_at: string;
}

// PROPERTIES
export interface Property {
  id: string;
  owner_id: string | null; // References user_profiles(id); NULL = org/admin-owned (no homeowner attached yet)
  organization_id: string | null;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  special_instructions: string | null;
  access_instructions: string | null;
  photo_url: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// SERVICE TYPES
export interface ServiceTypeRecord {
  id: string;
  organization_id: string; // Required - NOT nullable
  name: string;
  description: string | null;
  base_price: number; // numeric(10,2)
  duration_minutes: number; // NOT estimated_duration!
  service_type: string; // Now a free-form string, not an enum
  is_active: boolean; // default true
  created_at: string;
  updated_at: string;
}

// APPOINTMENTS
export interface Appointment {
  id: string;
  organization_id: string | null;
  homeowner_id: string | null; // References user_profiles(id); NULL only on self-pay (org-owned property)
  is_self_pay: boolean; // true → the org pays from its company card; settles 100% to the cleaner
  cleaner_id: string | null; // References cleaner_profiles(id)
  property_id: string;
  service_type_id: string;
  checklist_id: string | null; // References checklists(id)
  scheduled_date: string; // date
  scheduled_time: string; // time
  duration_minutes: number;
  status: AppointmentStatus;
  job_progress: JobProgress; // Tracks cleaner workflow progress
  total_price: number; // numeric(10,2)
  special_requests: string | null; // NOT special_instructions!
  notes: string | null;
  series_id: string | null; // References recurring_appointment_series(id)
  cleaner_confirmation_status: CleanerConfirmationStatus; // awaiting, approved, or rejected
  price_override_enabled: boolean;
  price_override_total: number | null; // Explicit override when admin/manager customizes total
  // Routing lifecycle: true when the homeowner submitted this as a request
  // (vs admin direct-book). Drives the auto-defer chain and hides cleaner
  // counter-propose.
  /** @deprecated Use `flow_type` instead. Kept for one release cycle. */
  homeowner_initiated: boolean;
  // The canonical "how was this appointment created" enum. Drives whether
  // the cleaner can counter-propose, whether request_state applies, etc.
  flow_type: AppointmentFlowType;
  // Sidecar lifecycle state; NULL on admin direct-book appointments that
  // aren't going through the routing flow.
  request_state: AppointmentRequestState | null;
  // Active-job photo gate — added in migration 095.
  photos_skipped: boolean;
  photo_skip_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Offered slots for a homeowner-initiated booking request. 1-3 rows per
// appointment, slot_index 0 = primary, 1..2 = alternates.
export interface AppointmentRequestedSlot {
  id: string;
  appointment_id: string;
  slot_index: number; // 0..2
  scheduled_date: string; // date
  scheduled_time: string; // time
  created_at: string;
}

// Routing attempts (max 3 per appointment).
export interface AppointmentRoutingLog {
  id: string;
  appointment_id: string;
  cleaner_id: string;
  attempt_index: number; // 1..3
  sent_at: string;
  deadline_at: string;
  response: RoutingLogResponse;
  responded_at: string | null;
  decline_reason: string | null;
  slot_index_chosen: number | null; // populated on accept
  created_at: string;
}

// RECURRING APPOINTMENT SERIES
export interface RecurringAppointmentSeries {
  id: string;
  organization_id: string;
  homeowner_id: string | null; // References user_profiles(id); NULL only on self-pay (org-owned property)
  is_self_pay: boolean; // propagates to every generated occurrence
  cleaner_id: string | null; // References cleaner_profiles(id)
  property_id: string;
  service_type_id: string;
  checklist_id: string | null; // References checklists(id)
  start_date: string; // date
  start_time: string; // time
  duration_minutes: number;
  total_price: number; // numeric(10,2)
  special_requests: string | null;
  recurrence_type: 'daily' | 'weekly' | 'monthly';
  interval: number; // every N days/weeks/months
  days_of_week: number[] | null; // for weekly patterns; 0=Sunday..6=Saturday
  end_date: string | null; // date
  max_occurrences: number | null;
  is_active: boolean;
  price_override_enabled: boolean;
  price_override_total: number | null;
  created_at: string;
  updated_at: string;
}

// PAYMENTS
export interface Payment {
  id: string;
  organization_id: string | null;
  appointment_id: string;
  amount: number; // numeric(10,2)
  status: PaymentStatus;
  payment_type: PaymentType;
  is_self_pay: boolean; // true → org-funded self-pay charge; excluded from revenue stats
  payment_method: PaymentMethod;
  stripe_payment_intent_id: string | null;
  stripe_setup_intent_id: string | null;
  tenant_transfer_attempt: number; // T1-11: tenant-transfer idempotency-key rotation counter (0 = unsuffixed key)
  manual_record_key: string | null; // T1-17: per-form-session dedupe key for manual "Record payment" rows
  charge_outcome_verified_at: string | null; // T1-16: sweep verification stamp for failed PI-less completion rows
  charge_outcome_unknown_since: string | null; // T1-16: latest unknown-outcome attempt time (grace anchor + concurrency token)
  notes: string | null;
  reference: string | null;
  paid_at: string | null;
  created_at: string;
}

// PAYOUTS
export interface Payout {
  id: string;
  organization_id: string | null;
  cleaner_id: string; // References cleaner_profiles(id)
  appointment_id: string; // References appointments(id)
  amount: number; // numeric(10,2)
  status: PayoutStatus;
  stripe_transfer_id: string | null;
  stripe_payout_id: string | null;
  transfer_attempt: number; // T1-11: transfer idempotency-key rotation counter (0 = unsuffixed key)
  payout_percent_snapshot: number | null; // numeric(5,2) — frozen at charge time
  is_self_pay: boolean; // true → cleaner payout funded by an org self-pay charge
  notes: string | null;
  approved_at: string | null;
  paid_at: string | null;
  bank_paid_at: string | null;
  reversed_at: string | null;
  created_at: string;
}

// INVOICES
export interface Invoice {
  id: string;
  organization_id: string | null;
  payment_id: string | null; // References payments(id)
  appointment_id: string | null; // References appointments(id)
  homeowner_id: string; // References user_profiles(id)
  invoice_number: string;
  amount: number; // numeric(10,2)
  status: InvoiceStatus;
  due_date: string | null; // date
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// CONVERSATIONS
export interface Conversation {
  id: string;
  participant_1_id: string; // References user_profiles(id)
  participant_2_id: string; // References user_profiles(id)
  /** NULL = office thread (a contact pair). NON-NULL = a per-appointment job thread (homeowner<->cleaner). */
  appointment_id: string | null;
  last_message_at: string;
  created_at: string;
}

// MESSAGES
export interface Message {
  id: string;
  organization_id: string | null;
  conversation_id: string | null; // References conversations(id)
  sender_id: string; // References user_profiles(id)
  recipient_id: string; // References user_profiles(id)
  appointment_id: string | null;
  subject: string | null;
  content: string;
  is_read: boolean; // default false
  created_at: string;
}

// MESSAGE ATTACHMENTS
export interface MessageAttachment {
  id: string;
  message_id: string; // References messages(id)
  file_url: string;
  file_type: string;
  file_size: number | null;
  created_at: string;
}

// MESSAGING UI TYPES (with joined data)
export interface ConversationWithDetails extends Conversation {
  other_participant: UserProfile;
  last_message: Message | null;
  /** Number of attachments on the last message (0 if none). Used to render
   *  "Photo" / "N photos" previews when the last message has no text. */
  last_message_attachment_count: number;
  unread_count: number;
}

export interface MessageWithDetails extends Message {
  sender: UserProfile;
  recipient: UserProfile;
  attachments?: MessageAttachment[];
}

// REVIEWS
export interface Review {
  id: string;
  organization_id: string | null;
  appointment_id: string;
  reviewer_id: string; // References user_profiles(id)
  reviewee_id: string; // References user_profiles(id)
  rating: number; // integer, 1-5
  comment: string | null;
  created_at: string;
}

// CHECKLISTS
export interface Checklist {
  id: string;
  name: string; // Defaults to 'checklist'
  service_type_id: string; // References service_types(id)
  price_adder: number; // numeric(10,2) adder to service base price
  position: number | null; // 0-indexed tier order; NULL sorts last (migration 090)
  created_at: string;
  updated_at: string;
}

// CHECKLIST LINE ITEMS
export interface ChecklistLineItem {
  id: string;
  task: string;
  checklist_id: string; // References checklists(id)
  position: number | null; // Sort order within checklist (0-indexed, NULL sorts last)
  created_at: string;
}

// Checklist with nested line items (for UI)
export interface ChecklistWithItems extends Checklist {
  checklist_line_items: ChecklistLineItem[];
}

// CLEANER AVAILABILITY FEEDBACK
export interface CleanerAvailabilityFeedback {
  id: string;
  appointment_id: string;
  cleaner_id: string;
  reason: string | null;
  created_at: string;
}

// CLEANER SUGGESTED TIMES
export interface CleanerSuggestedTime {
  id: string;
  feedback_id: string;
  suggested_date: string; // date
  suggested_time: string; // time
  created_at: string;
}

// CLEANER SUGGESTED WINDOWS
export interface CleanerSuggestedWindow {
  id: string;
  feedback_id: string;
  window_date: string; // date
  start_time: string; // time
  end_time: string; // time
  created_at: string;
}

// Feedback with nested suggested times and windows (for UI)
export interface CleanerFeedbackWithTimes extends CleanerAvailabilityFeedback {
  cleaner_suggested_times: CleanerSuggestedTime[];
  cleaner_suggested_windows: CleanerSuggestedWindow[];
}

// ==========================================
// APPOINTMENT BUCKETS (Wave 1 — 5 user-visible buckets)
// ==========================================

// User-visible status buckets, derived from `appointments.status` +
// `cleaner_confirmation_status` + whether a counter-proposal exists.
// `cancelled` is rendered like a bucket but isn't part of the 5 "live" buckets.
export type AppointmentBucket =
  | 'pending'
  | 'counter_proposed'
  | 'confirmed'
  | 'in_progress'
  | 'done'
  | 'cancelled';

// Canned decline reasons cleaner can pick when hard-declining an assignment.
// Reason text is stored verbatim in cleaner_availability_feedback.reason; the
// enum lives client-side until reporting needs a DB-level enum.
export type DeclineReason = 'sick' | 'not_available' | 'not_my_service' | 'too_far' | 'other';

export function declineReasonLabel(reason: DeclineReason): string {
  switch (reason) {
    case 'sick':
      return 'Sick';
    case 'not_available':
      return 'Not available';
    case 'not_my_service':
      return 'Not my service';
    case 'too_far':
      return 'Too far';
    case 'other':
      return 'Other';
  }
}

/**
 * Reasons that surface in the admin reschedule modal. Includes the canned
 * cleaner declines plus 'expired' for SLA timeouts (written by the auto-defer
 * route into appointment_routing_log.decline_reason when a deadline passes).
 */
export type RoutingDeclineReason = DeclineReason | 'expired';

/**
 * Display label for any string that might land in appointment_routing_log
 * .decline_reason. Tolerant of unknown values — falls back to a generic
 * "Unknown reason" rather than silently rendering the wrong canned label.
 */
export function routingDeclineReasonLabel(
  reason: string | null | undefined,
): string {
  if (!reason) return 'No reason given';
  switch (reason) {
    case 'expired':
      return 'Did not respond before deadline';
    case 'sick':
    case 'not_available':
    case 'not_my_service':
    case 'too_far':
    case 'other':
      return declineReasonLabel(reason);
    default:
      // Cleaner may have entered free-text via 'other'; show it as-is.
      return reason;
  }
}

/**
 * Derive the user-visible bucket for an appointment. Counter-proposed is
 * recognised by the presence of cleaner-suggested times alongside a
 * `rejected` confirmation status.
 */
export function getAppointmentBucket(
  appointment: Pick<Appointment, 'status' | 'cleaner_confirmation_status'>,
  hasSuggestedTimes: boolean,
): AppointmentBucket {
  if (appointment.status === 'cancelled') return 'cancelled';
  if (appointment.status === 'completed') return 'done';
  if (appointment.status === 'in_progress') return 'in_progress';
  if (appointment.status === 'confirmed') return 'confirmed';
  // status === 'pending'
  if (
    appointment.cleaner_confirmation_status === 'rejected' &&
    hasSuggestedTimes
  ) {
    return 'counter_proposed';
  }
  return 'pending';
}

// ==========================================
// JOB WORKFLOW TYPES
// ==========================================

// Checklist item for job workflow (includes completion state)
export interface ChecklistItem {
  id: string;
  task: string;
  completed: boolean;
}

// Job workflow state for session storage
export interface JobWorkflowState {
  step: JobProgress;
  checklistProgress: ChecklistItem[];
  hasBeforePhotos: boolean;
  hasAfterPhotos: boolean;
  lastUpdated: string;
}

// ==========================================
// LEGACY TYPES (For backward compatibility)
// TODO: Gradually migrate these to use database types above
// ==========================================

export interface User {
  id: string;
  email: string;
  role: UserRole;
  profile: {
    firstName: string;
    lastName: string;
    phone: string;
    avatarUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, role: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

export interface BookingFormData {
  propertyId?: string;
  address: string;
  dateTime: string;
  notes?: string;
  recurringWeekly?: boolean;
  recurringBiweekly?: boolean;
}

export interface CleanerStats {
  totalJobs: number;
  completedJobs: number;
  totalEarnings: number;
  pendingPayouts: number;
}

export interface AdminStats {
  totalBookings: number;
  activeCleaners: number;
  totalRevenue: number;
  pendingApprovals: number;
  monthlyGrowth: number;
}

export interface ChatRoom {
  id: string;
  bookingId: string;
  participants: User[];
  lastMessage?: Message;
  unreadCount: number;
}

export interface ServiceArea {
  zipCode: string;
  city: string;
  state: string;
  isActive: boolean;
}

export interface PricingTier {
  id: string;
  name: string;
  basePrice: number;
  description: string;
  features: string[];
}

// CHECKLIST ITEM COMPLETIONS — added in migration 095
export interface ChecklistItemCompletion {
  id: string;
  appointment_id: string;
  checklist_line_item_id: string;
  organization_id: string | null;
  completed_at: string;
  created_at: string;
}

// Charge projection sent to the client (consumed by the cleaner Complete sheet).
// In 'payout_only' mode the customer-charge fields (baseCents/method/chargeCents/
// feeCents/payoutPercent) are OMITTED from the cleaner's response by the API, so
// they are optional here. Org staff always receive the full ('full') shape.
export interface ChargeProjection {
  display: 'full' | 'payout_only';
  cleanerCutCents: number;
  isSelfPay: boolean;
  // present only when display === 'full':
  baseCents?: number;
  method?: 'card' | 'us_bank_account';
  chargeCents?: number;
  feeCents?: number;
  platformFeeCents?: number;
  payoutPercent?: number;
}

// ==========================================
// IMPORTANT REMINDERS
// ==========================================
// 
// When querying Supabase:
// - Use `duration_minutes` NOT `estimated_duration`
// - Use `special_requests` NOT `special_instructions` (in appointments table)
// - cleaner_profiles.id IS the user's id (no separate user_id column)
// - All column names are snake_case in database
// - appointments.request_state is NULL for admin direct-book appointments;
//   populated only on homeowner-initiated requests (homeowner_initiated=true).
//   See migration 059 and appointment_requested_slots / appointment_routing_log.
// 
// See DB-SCHEMA-REFERENCE.md for complete schema documentation.
