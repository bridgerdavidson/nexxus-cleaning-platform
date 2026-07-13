import type { AdminProperty } from "@/hooks/useAdminData";

export interface PropertyRowVM {
  id: string;
  name: string;
  addressLine: string;
  ownerLabel: string;
  isOrgOwned: boolean;
  detailsLabel: string;
  photoUrl: string | null;
}

export function toPropertyRowVM(p: AdminProperty): PropertyRowVM {
  const isOrgOwned = !p.owner_id;
  const ownerLabel = isOrgOwned
    ? "Org-owned"
    : [p.homeowner?.first_name, p.homeowner?.last_name].filter(Boolean).join(" ") || "Unknown";
  const details = [
    p.bedrooms != null ? `${p.bedrooms} bd` : null,
    p.bathrooms != null ? `${p.bathrooms} ba` : null,
    p.square_feet != null ? `${p.square_feet.toLocaleString()} sf` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    id: p.id,
    name: p.name,
    addressLine: [p.address, p.city, p.state].filter(Boolean).join(", "),
    ownerLabel,
    isOrgOwned,
    detailsLabel: details || "No details",
    photoUrl: p.photo_url ?? null,
  };
}
