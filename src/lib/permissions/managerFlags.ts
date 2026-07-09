export const MANAGER_FLAG_GROUPS = [
  'Bookings',
  'Customers',
  'Properties',
  'Services',
  'Payments & payouts',
  'Insight & comms',
  'Cleaners & team',
] as const;
export type ManagerFlagGroup = (typeof MANAGER_FLAG_GROUPS)[number];

export const MANAGER_FLAG_KEYS = [
  'can_view_bookings',
  'can_edit_bookings',
  'can_handle_requests',
  'can_view_customers',
  'can_edit_customers',
  'can_view_properties',
  'can_edit_properties',
  'can_view_services',
  'can_manage_services',
  'can_view_payments',
  'can_manage_payments',
  'can_view_analytics',
  'can_view_messages',
  'can_manage_cleaners',
] as const;
export type ManagerPermissionKey = (typeof MANAGER_FLAG_KEYS)[number];
export type ManagerPermissions = Record<ManagerPermissionKey, boolean>;

export interface ManagerFlag {
  key: ManagerPermissionKey;
  label: string;
  description: string;
  group: ManagerFlagGroup;
  enforce: 'route' | 'rls' | 'rpc' | 'ui';
}

export const MANAGER_FLAGS: readonly ManagerFlag[] = [
  { key: 'can_view_bookings', label: 'View bookings', description: 'See the bookings calendar and lists.', group: 'Bookings', enforce: 'route' },
  { key: 'can_edit_bookings', label: 'Create & edit bookings', description: 'Create, update, cancel and reschedule appointments.', group: 'Bookings', enforce: 'route' },
  { key: 'can_handle_requests', label: 'Handle requests', description: 'Approve or decline pending requests and assign cleaners.', group: 'Bookings', enforce: 'route' },
  { key: 'can_view_customers', label: 'View customers', description: 'See customer profiles and history.', group: 'Customers', enforce: 'ui' },
  { key: 'can_edit_customers', label: 'Edit customers', description: 'Edit customer details and invite homeowners.', group: 'Customers', enforce: 'route' },
  { key: 'can_view_properties', label: 'View properties', description: 'See property details and access notes.', group: 'Properties', enforce: 'ui' },
  { key: 'can_edit_properties', label: 'Edit properties', description: 'Create and update property records.', group: 'Properties', enforce: 'rls' },
  { key: 'can_view_services', label: 'View services', description: 'See the service catalog.', group: 'Services', enforce: 'ui' },
  { key: 'can_manage_services', label: 'Manage services', description: 'Edit pricing and service types.', group: 'Services', enforce: 'rls' },
  { key: 'can_view_payments', label: 'View payments', description: 'See payments, invoices and payout status.', group: 'Payments & payouts', enforce: 'rpc' },
  { key: 'can_manage_payments', label: 'Manage payments', description: 'Charge cards, record payments, create invoices and manage payouts.', group: 'Payments & payouts', enforce: 'route' },
  { key: 'can_view_analytics', label: 'View analytics', description: 'See analytics and reports (money figures hidden unless View payments is on).', group: 'Insight & comms', enforce: 'rpc' },
  { key: 'can_view_messages', label: 'View messages', description: 'See and use the messaging inbox.', group: 'Insight & comms', enforce: 'ui' },
  { key: 'can_manage_cleaners', label: 'Manage cleaners', description: 'Invite, edit and remove cleaners.', group: 'Cleaners & team', enforce: 'route' },
];

export function emptyManagerPermissions(): ManagerPermissions {
  return MANAGER_FLAG_KEYS.reduce((acc, k) => {
    acc[k] = false;
    return acc;
  }, {} as ManagerPermissions);
}

export function coerceManagerPermissions(
  row: Partial<Record<string, unknown>> | null | undefined,
): ManagerPermissions {
  return MANAGER_FLAG_KEYS.reduce((acc, k) => {
    acc[k] = Boolean(row?.[k]);
    return acc;
  }, {} as ManagerPermissions);
}

const PRESET_ON: ManagerPermissionKey[] = [
  'can_view_bookings', 'can_edit_bookings', 'can_handle_requests',
  'can_view_customers', 'can_edit_customers',
  'can_view_properties', 'can_view_services',
  'can_view_analytics', 'can_view_messages',
];

export const STANDARD_MANAGER_PRESET: ManagerPermissions = MANAGER_FLAG_KEYS.reduce((acc, k) => {
  acc[k] = PRESET_ON.includes(k);
  return acc;
}, {} as ManagerPermissions);

/** Comma-separated column list for a `manager_permissions` .select(). */
export const MANAGER_FLAG_SELECT = MANAGER_FLAG_KEYS.join(', ');
