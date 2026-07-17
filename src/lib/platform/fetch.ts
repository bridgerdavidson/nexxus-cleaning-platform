/**
 * Bearer-authenticated fetch for the platform-owner routes (`/api/platform/*`).
 * Throws with the route's `error` message on a non-2xx response. Shared by the
 * platform hooks (organizations, stats, audit).
 */
export async function platformFetch<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
