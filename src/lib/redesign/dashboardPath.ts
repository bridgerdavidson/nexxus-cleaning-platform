/** Post-login destination for a user role. The redesign is the app now, so every
 *  role routes to its /app screen. The `opts` param is kept for call-site
 *  compatibility (callers still pass `{ redesign: redesignUiEnabled() }`) but is
 *  ignored; the legacy non-/app branches were removed in Phase 4 (4d). */
export function getDashboardPath(role: string, opts?: { redesign?: boolean }): string {
  void opts; // kept for call-site compatibility; redesign is always on now
  switch (role) {
    case "homeowner":
      return "/app/homeowner-dashboard";
    case "cleaner":
      return "/app/cleaner-dashboard";
    case "manager":
      return "/app/admin-dashboard";
    case "admin":
      return "/app/admin-dashboard";
    default:
      // A recognized role is always derived by AuthContext, so this is defensive.
      // "/" is safe: next.config rewrites it to the marketing landing (a terminal
      // rewrite, not a redirect), so a role-less user lands there without looping.
      return "/";
  }
}
