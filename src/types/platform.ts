/**
 * Shapes returned by the platform-owner back-office routes (/api/platform/*).
 * Kept in a client-safe module so hooks/components can import the types without
 * pulling a server route (and supabase-admin) into the client bundle.
 */

export interface PlatformOrgMemberCounts {
  owner: number;
  admin: number;
  manager: number;
  cleaner: number;
  homeowner: number;
  total: number;
}

export interface PlatformOrgSummary {
  id: string;
  name: string;
  billing_email: string | null;
  subscription_status: string;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  created_at: string;
  member_counts: PlatformOrgMemberCounts;
}

export interface PlatformOrgMember {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string;
}

export interface PlatformOrgDetail extends PlatformOrgSummary {
  subscription_id: string | null;
  subscription_current_period_end: string | null;
  platform_fee_bps: number;
  default_payout_model: string;
  stripe_connect_details_submitted: boolean;
  stripe_connect_requirements_due: string[];
  members: PlatformOrgMember[];
  counts: { appointments: number };
}

export const EMPTY_MEMBER_COUNTS: PlatformOrgMemberCounts = {
  owner: 0,
  admin: 0,
  manager: 0,
  cleaner: 0,
  homeowner: 0,
  total: 0,
};

/** Platform-wide overview metrics from the `platform_stats()` RPC. Money in cents. */
export interface PlatformStats {
  tenants: number;
  active_plans: number;
  trialing: number;
  payments_ready: number;
  platform_fees_cents: number;
  gmv_cents: number;
  total_appointments: number;
  new_tenants_30d: number;
}
