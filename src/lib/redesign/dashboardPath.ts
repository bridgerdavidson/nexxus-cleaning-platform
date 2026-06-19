/** Post-login destination for a user role. When redesign is on, only admin
 *  is routed to the new operator screen (other redesign screens don't exist yet). */
export function getDashboardPath(role: string, opts?: { redesign?: boolean }): string {
  const redesign = opts?.redesign ?? false;
  switch (role) {
    case "homeowner":
      return "/homeowner-dashboard";
    case "cleaner":
      return "/cleaner-dashboard";
    case "manager":
      return "/manager-dashboard";
    case "admin":
      return redesign ? "/app/admin-dashboard" : "/admin-dashboard";
    default:
      return "/";
  }
}
