// View-model types for the redesigned Operator "Cleaners & team" screen. The
// View and its sub-components are pure functions of these shapes so they render
// the same from real hook data (OperatorCleaners) or mock data (dev preview).

/** Sort options for the roster. Cleaners DO have a lifecycle (active/benched +
 *  pending invites), but that is expressed as a pinned group + a benched filter,
 *  not sort, so sorting stays orthogonal. */
export type CleanerSort = "name" | "load" | "earnings" | "recent";

export const CLEANER_SORTS: { id: CleanerSort; label: string }[] = [
  { id: "name", label: "Name (A to Z)" },
  { id: "load", label: "Most jobs this week" },
  { id: "earnings", label: "Top earners" },
  { id: "recent", label: "Newest" },
];

export type CleanerStatus = "active" | "benched";

/** Stripe Connect payout readiness, derived from the two cached cleaner_profiles
 *  columns: ready = onboarding complete; incomplete = account started but not
 *  finished; none = no Connect account yet. */
export type ConnectState = "ready" | "incomplete" | "none";

export type CleanerRowAction = "open" | "edit" | "deactivate" | "reactivate" | "remove";
export type InviteRowAction = "resend" | "cancel";

/** Invite statuses shown in the roster's Pending group (terminal states like
 *  accepted/superseded/revoked are filtered out before mapping). */
export type PendingInviteStatus = "pending" | "creating" | "failed" | "expired";

/** One cleaner row (desktop table row / mobile card). */
export type CleanerRowVM = {
  id: string;
  name: string; // "Jane Smith", or the email when no name is set
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  initials: string;
  status: CleanerStatus;
  connect: ConnectState;
  /** "Owed $240" alert: money not yet sent (pending + approved payouts), gated
   *  by canViewPayments. null when nothing is owed or payments are hidden. */
  owedLabel: string | null;
  /** A failed/reversed payout needs attention (operational alert, not a dollar
   *  figure, so it shows regardless of canViewPayments). */
  payoutFailed: boolean;
  thisWeekLabel: string; // "4 this week" / "No jobs this week"
  upcomingCount: number;
  /** "$1,240" lifetime cleaner earnings, gated by canViewPayments; null when hidden. */
  earningsLabel: string | null;
  /** Mode-aware pay chip: "60% cut" / "$80 per job" / "Names their pay". */
  payLabel: string;
  /** False = no pay decision was ever made for this cleaner ("Pay not set" badge). */
  payConfigured: boolean;
};

export type PendingInviteRowVM = {
  inviteId: string;
  email: string;
  status: PendingInviteStatus;
  invitedLabel: string; // "Invited Jun 12"
  canResend: boolean;
};

export type CleanerScorecardVM = {
  completedJobs: number;
  completionRateLabel: string; // "92%" or "N/A"
  upcomingJobs: number;
  completedThisWeek: number;
  lifetimeEarningsLabel: string | null; // gated by canViewPayments
  pendingOwedLabel: string | null; // gated by canViewPayments
  ratingLabel: string; // "No ratings yet" until review collection ships
};

export type CleanerUpcomingVM = {
  id: string;
  dateLabel: string; // "Jun 12 at 9:00 AM"
  service: string;
  property: string | null;
  status: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled";
  priceLabel: string | null; // gated by canViewPayments
};

export type CleanerPayoutHealthVM = {
  owedNowLabel: string | null; // gated by canViewPayments
  failedCount: number;
  connect: ConnectState;
};

/** Full detail surface (slide-over Sheet). Row fields come from the list row;
 *  scorecard counts come from the roster RPC; upcoming jobs load lazily. */
export type CleanerDetailVM = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  initials: string;
  status: CleanerStatus;
  connect: ConnectState;
  isAvailable: boolean;
  backgroundCheckVerified: boolean;
  insuranceVerified: boolean;
  // Raw editable fields for the inline edit form.
  firstName: string;
  lastName: string;
  payoutPercent: number;
  /** 'percentage' | 'flat' | 'request' | 'hourly_external' (legacy spelling normalized upstream). */
  payoutModel: string;
  flatRateCents: number | null;
  /** False = no pay decision was ever made; the edit form starts with no mode selected. */
  payConfigured: boolean;
  hourlyRate: number | null;
  experienceYears: number | null;
  scorecard: CleanerScorecardVM;
  payoutHealthDetail: CleanerPayoutHealthVM;
};
