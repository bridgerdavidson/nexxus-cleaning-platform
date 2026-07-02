import { personInitials } from '@/lib/initials';

/** A name-bearing shape (the camelCase auth profile shim). */
export interface HomeownerProfileNameLike {
  firstName?: string | null;
  lastName?: string | null;
}

/** Up-to-two-letter initials for the avatar fallback, uppercased ("U" fallback). */
export function homeownerInitials(p: HomeownerProfileNameLike): string {
  return personInitials(p.firstName, p.lastName) || 'U';
}
