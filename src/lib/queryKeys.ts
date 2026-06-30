export const keys = {
  appointments: {
    all: ['appointments'] as const,
    byOrg: (orgId: string) => ['appointments', 'org', orgId] as const,
    byCleaner: (cleanerId: string) => ['appointments', 'cleaner', cleanerId] as const,
    byHomeowner: (homeownerId: string) => ['appointments', 'homeowner', homeownerId] as const,
    detail: (id: string) => ['appointments', 'detail', id] as const,
    requestsByHomeowner: (homeownerId: string) =>
      ['appointments', 'requests', 'homeowner', homeownerId] as const,
    actionItemsByOrg: (orgId: string) =>
      ['appointments', 'action-items', 'org', orgId] as const,
    routingLog: (appointmentId: string) =>
      ['appointments', 'routing-log', appointmentId] as const,
    checklistCompletions: (appointmentId: string) =>
      ['appointments', 'checklist-completions', appointmentId] as const,
    checklistTotal: (checklistId: string) =>
      ['appointments', 'checklist-total', checklistId] as const,
    chargeProjection: (appointmentId: string) =>
      ['appointments', 'charge-projection', appointmentId] as const,
  },
  payments: {
    all: ['payments'] as const,
    byOrg: (orgId: string) => ['payments', 'org', orgId] as const,
    infinite: (orgId: string) => ['payments', 'infinite', orgId] as const,
    byHomeowner: (homeownerId: string) => ['payments', 'homeowner', homeownerId] as const,
    byAppointment: (apptId: string) => ['payments', 'appointment', apptId] as const,
    statsByOrg: (orgId: string) => ['payments', 'stats', orgId] as const,
  },
  payouts: {
    all: ['payouts'] as const,
    byOrg: (orgId: string) => ['payouts', 'org', orgId] as const,
    infinite: (orgId: string) => ['payouts', 'infinite', orgId] as const,
    byCleaner: (cleanerId: string) => ['payouts', 'cleaner', cleanerId] as const,
  },
  invoices: {
    byOrg: (orgId: string) => ['invoices', 'org', orgId] as const,
  },
  services: {
    all: ['services'] as const,
    byOrg: (orgId: string) => ['services', 'org', orgId] as const,
    detail: (id: string) => ['services', 'detail', id] as const,
  },
  invites: {
    byOrg: (orgId: string) => ['invites', 'org', orgId] as const,
  },
  customers: {
    byOrg: (orgId: string) => ['customers', 'org', orgId] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
  },
  properties: {
    byOrg: (orgId: string) => ['properties', 'org', orgId] as const,
    byHomeowner: (homeownerId: string) => ['properties', 'homeowner', homeownerId] as const,
  },
  conversations: {
    byUser: (userId: string, scope: 'office' | 'job' | 'org-office' = 'office') =>
      ['conversations', 'user', userId, scope] as const,
  },
  messages: {
    byConversation: (convId: string) => ['messages', 'conversation', convId] as const,
    unreadCount: (userId: string, scope: 'office' | 'all' = 'office') =>
      ['messages', 'unread', userId, scope] as const,
  },
  notifications: {
    byUser: (userId: string) => ['notifications', 'user', userId] as const,
  },
  stats: {
    admin: (orgId: string) => ['stats', 'admin', orgId] as const,
    cleaner: (cleanerId: string) => ['stats', 'cleaner', cleanerId] as const,
    homeowner: (homeownerId: string) => ['stats', 'homeowner', homeownerId] as const,
  },
  teamMembers: {
    byOrg: (orgId: string) => ['team-members', 'org', orgId] as const,
  },
  staff: {
    byOrg: (orgId: string) => ['staff', 'org', orgId] as const,
  },
  checklists: {
    byServiceType: (serviceTypeId: string) => ['checklists', 'service-type', serviceTypeId] as const,
  },
  organizationMembers: {
    byOrg: (orgId: string) => ['organization-members', 'org', orgId] as const,
  },
  managerPermissions: {
    byUser: (userId: string) => ['manager-permissions', 'user', userId] as const,
  },
  analytics: {
    byOrg: (orgId: string, range: string) => ['analytics', 'org', orgId, range] as const,
    all: ['analytics'] as const,
    summary: (orgId: string, range: string) => ['analytics', 'summary', orgId, range] as const,
    timeseries: (orgId: string, range: string) => ['analytics', 'timeseries', orgId, range] as const,
    serviceMix: (orgId: string, range: string) => ['analytics', 'serviceMix', orgId, range] as const,
    leaderboard: (orgId: string, range: string) => ['analytics', 'leaderboard', orgId, range] as const,
    demand: (orgId: string, range: string) => ['analytics', 'demand', orgId, range] as const,
    cancellations: (orgId: string, range: string) => ['analytics', 'cancellations', orgId, range] as const,
  },
  jobPhotos: {
    byAppointment: (apptId: string) => ['job-photos', 'appointment', apptId] as const,
  },
  cleanerProfiles: {
    byOrg: (orgId: string) => ['cleaner-profiles', 'org', orgId] as const,
    scorecards: (orgId: string) => ['cleaner-profiles', 'scorecards', orgId] as const,
    detail: (id: string) => ['cleaner-profiles', 'detail', id] as const,
  },
  stripeConnect: {
    byCleaner: (cleanerId: string) => ['stripe-connect', 'cleaner', cleanerId] as const,
  },
  cleanerEarnings: {
    summary: (cleanerId: string) => ['cleaner-earnings', 'summary', cleanerId] as const,
    history: (cleanerId: string, start: string, end: string) =>
      ['cleaner-earnings', 'history', cleanerId, start, end] as const,
    projected: (cleanerId: string, start: string, end: string) =>
      ['cleaner-earnings', 'projected', cleanerId, start, end] as const,
  },
  platform: {
    organizations: {
      all: ['platform', 'organizations'] as const,
      detail: (id: string) => ['platform', 'organizations', 'detail', id] as const,
    },
  },
};
