/**
 * The route prefixes where tenant branding is allowed to appear.
 *
 * Marketing, /login, /signup stay Nexxus (spec decision 10), /owner is a
 * platform surface, and /billing/add-card brands itself with LINK-scoped local
 * CSS variables (never the document-level ramp). Everything that applies org
 * branding at the document level (the pre-paint bootstrap, BrandProvider's CSS
 * variables, BrandDocumentIdentity's tab chrome) must consult this ONE list,
 * or the tenant's colors bleed into platform surfaces.
 *
 * Import-light on purpose: the bootstrap script inlines these values into the
 * <head> script, so this module must not pull in palette/culori.
 */
export const BRANDED_APP_PREFIXES = ["/admin", "/cleaner", "/homeowner"] as const;

/** True when `pathname` is inside a tenant app surface (prefix-boundary safe:
 *  "/admin" and "/admin/x" match, "/administrator" does not). */
export function isBrandedAppPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return BRANDED_APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
