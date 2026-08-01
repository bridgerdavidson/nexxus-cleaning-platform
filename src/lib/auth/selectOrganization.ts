/**
 * Which organization a user lands in.
 *
 * Before white-label this was whichever row Postgres happened to return first
 * (`.limit(1)` with no ORDER BY), which is arbitrary. Branding makes that
 * visible: a cleaner working for two companies would see the wrong company's
 * logo. See docs/white-label-branding.md decision 7.
 */
export interface MembershipRow {
  organization_id: string;
  role: string;
  created_at?: string | null;
}

export function selectOrganization(
  rows: MembershipRow[],
  rememberedId?: string | null,
): MembershipRow | null {
  if (rows.length === 0) return null;

  const remembered = rememberedId ? rows.find((r) => r.organization_id === rememberedId) : undefined;
  if (remembered) return remembered;

  // Oldest membership wins; organization_id breaks ties so two rows with the
  // same (or missing) timestamp still resolve deterministically.
  return [...rows].sort((x, y) => {
    const xt = x.created_at ?? "";
    const yt = y.created_at ?? "";
    if (xt !== yt) return xt < yt ? -1 : 1;
    return x.organization_id < y.organization_id ? -1 : 1;
  })[0];
}
