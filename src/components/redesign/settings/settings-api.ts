import { getAccessToken } from "@/lib/auth/clientAccessToken";

async function patch(path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not save changes");
  return data;
}

export const updateOrgProfile = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/profile`, body);
export const updateOrgPaymentSettings = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/payment-settings`, body);
export const updateOrgBusinessHours = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/business-hours`, body);
export const updateOrgCleanerPayouts = (orgId: string, body: Record<string, unknown>) =>
  patch(`/api/organizations/${orgId}/cleaner-payouts`, body);
