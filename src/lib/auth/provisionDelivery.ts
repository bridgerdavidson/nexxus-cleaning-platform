import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { ownerProvisionEmail } from '@/lib/email/templates/ownerProvisionEmail';

export type OwnerProvisionDeliveryResult = { ok: true } | { ok: false; error: string };

/**
 * Create the founder's auth user and deliver the owner-provision email,
 * NEXXUS-branded.
 *
 * The platform voice is deliberate and is what separates this from
 * deliverInviteEmail: a member invite is white-labeled as the inviting org,
 * but a provisioned founder has no relationship with their org yet. The
 * inbox row reads "Nexxus" and the body is the platform granting ownership
 * (src/lib/email/templates/ownerProvisionEmail.ts).
 *
 * Mechanics mirror inviteDelivery.ts exactly:
 * - With SMTP: admin.generateLink({ type: 'invite' }) creates the user without
 *   sending anything, then the Brevo transport sends with fromName 'Nexxus'.
 *   The emailed URL is redirectTo itself (never the consumable action link;
 *   see inviteDelivery.ts for the scanner-prefetch rationale). The accept page
 *   mints a fresh token via /api/accept-invite/claim on the button click.
 * - Without SMTP: fall back to GoTrue's inviteUserByEmail so provisioning
 *   still works (platform-branded via the project's auth SMTP).
 * - Both paths leave identical auth state. If the send fails AFTER
 *   generateLink created the user, the caller marks the invite row failed;
 *   the send-invite route's stale-invitee cleanup deletes the membership-less
 *   auth user before any later attempt.
 *
 * Hosted brand images resolve from APP_URL (same trusted-base rule as every
 * emailed link); without it the template degrades to its text lockup.
 */
export async function deliverOwnerProvisionEmail({
  email,
  orgName,
  redirectTo,
}: {
  email: string;
  orgName: string;
  redirectTo: string;
}): Promise<OwnerProvisionDeliveryResult> {
  if (!emailConfigured()) {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data) return { ok: false, error: error?.message ?? 'no invite data returned' };
    return { ok: true };
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  });
  if (linkError || !linkData?.user) {
    return { ok: false, error: linkError?.message ?? 'no invite data returned' };
  }

  try {
    const assetBaseUrl =
      (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').trim() || null;
    const message = ownerProvisionEmail({ orgName, url: redirectTo, assetBaseUrl });
    await sendEmail({ to: email, fromName: 'Nexxus', ...message });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
