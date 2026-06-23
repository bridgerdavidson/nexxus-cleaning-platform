import { Crown, ShieldCheck, UserCog } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { StaffRole } from "./staff-types";

// Role badge for a staff member. Owner is the strongest (brand), admin and
// manager are quieter; the distinct icons keep them legible at a glance.

const ROLE: Record<StaffRole, { label: string; variant: BadgeProps["variant"]; Icon: React.ComponentType<{ className?: string }> }> = {
  owner: { label: "Owner", variant: "default", Icon: Crown },
  admin: { label: "Admin", variant: "secondary", Icon: ShieldCheck },
  manager: { label: "Manager", variant: "outline", Icon: UserCog },
};

export function RoleBadge({ role }: { role: StaffRole }) {
  const c = ROLE[role] ?? ROLE.manager;
  return (
    <Badge variant={c.variant} className="shrink-0 whitespace-nowrap">
      <c.Icon /> {c.label}
    </Badge>
  );
}
