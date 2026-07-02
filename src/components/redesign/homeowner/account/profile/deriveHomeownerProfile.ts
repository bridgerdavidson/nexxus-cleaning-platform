import { personInitials } from '@/lib/initials';

/** A name-bearing shape (the camelCase auth profile shim). */
export interface HomeownerProfileNameLike {
  firstName?: string | null;
  lastName?: string | null;
}

/** Display name from the auth profile, or a generic fallback when nothing is set. */
export function homeownerDisplayName(p: HomeownerProfileNameLike): string {
  const name = [p.firstName, p.lastName]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return name || 'Your profile';
}

/** Up-to-two-letter initials for the avatar fallback, uppercased ("U" fallback). */
export function homeownerInitials(p: HomeownerProfileNameLike): string {
  return personInitials(p.firstName, p.lastName) || 'U';
}
