/** Post-login destination for a user role. The redesign is the app now, so every
 *  role routes to its top-level shell (Phase 4, 4e removed the /app prefix). */
export function getDashboardPath(role: string): string {
  switch (role) {
    case "homeowner":
      return "/homeowner";
    case "cleaner":
      return "/cleaner";
    case "manager":
      return "/admin";
    case "admin":
      return "/admin";
    default:
      // A recognized role is always derived by AuthContext, so this is defensive.
      // "/" is safe: next.config rewrites it to the marketing landing (a terminal
      // rewrite, not a redirect), so a role-less user lands there without looping.
      return "/";
  }
}
