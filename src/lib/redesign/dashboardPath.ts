/** Post-login destination for a user role. When redesign is on, admin, cleaner,
 *  and homeowner route to new screens (other redesign screens don't exist yet). */
export function getDashboardPath(role: string, opts?: { redesign?: boolean }): string {
  const redesign = opts?.redesign ?? false;
  switch (role) {
    case "homeowner":
      return redesign ? "/app/homeowner-dashboard" : "/homeowner-dashboard";
    case "cleaner":
      return redesign ? "/app/cleaner-dashboard" : "/cleaner-dashboard";
    case "manager":
      return redesign ? "/app/admin-dashboard" : "/manager-dashboard";
    case "admin":
      return redesign ? "/app/admin-dashboard" : "/admin-dashboard";
    default:
      return "/";
  }
}
