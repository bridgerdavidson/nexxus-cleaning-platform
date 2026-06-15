export function getRoleBadgeClasses(role: string | null | undefined): string {
  switch ((role || "").toLowerCase()) {
    case "admin":
      return "bg-purple-100 text-purple-700";
    case "manager":
      return "bg-blue-100 text-blue-700";
    case "cleaner":
      return "bg-green-100 text-green-700";
    case "homeowner":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

// User-facing label for a role. Homeowners are surfaced as "Customer" across
// the app (Customers page, invite modal), so map it here rather than showing
// the raw "Homeowner" enum value. Other roles are simply capitalized.
export function getRoleLabel(role: string | null | undefined): string {
  const r = (role || "").toLowerCase();
  if (r === "homeowner") return "Customer";
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : "";
}
