import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { inviteEmail } from '@/lib/email/templates/inviteEmail';

export type InviteDeliveryResult = { ok: true } | { ok: false; error: string };

/**
 * Create the invited auth user and deliver their invite email, org-branded.
 *
 * With SMTP configured: mint the action link ourselves (admin.generateLink with
 * type 'invite' creates the user exactly like inviteUserByEmail but sends
 * nothing) and send it through the Brevo transport, so the inbox row shows the
 * org's name as sender (the #251 white-label pattern) and the body carries the
 * org's color and logo. GoTrue can only hold ONE global sender name and ONE
 * template per project, which is why per-org branding must bypass its mailer.
 *
 * Without SMTP: fall back to GoTrue's inviteUserByEmail so invites still
 * deliver (platform-branded, via the project's auth SMTP) in environments
 * where the app transport isn't configured. Never fail an invite for lack of
 * branding.
 *
 * Both paths leave identical auth state (an invited user whose action link
 * lands on redirectTo). If the email send fails AFTER generateLink created the
 * user, the caller marks the invite row failed; the resend flow's
 * stale-invitee cleanup (send-invite route) deletes the membership-less auth
 * user before the next attempt, so a retry is never blocked.
 */
export async function deliverInviteEmail({
  email,
  organizationId,
  redirectTo,
}: {
  email: string;
  organizationId: string;
  redirectTo: string;
}): Promise<InviteDeliveryResult> {
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
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) {
    return { ok: false, error: linkError?.message ?? 'no invite link returned' };
  }

  try {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, brand_color, logo_icon_url')
      .eq('id', organizationId)
      .maybeSingle();
    const orgRow = org as {
      name?: string;
      brand_color?: string | null;
      logo_icon_url?: string | null;
    } | null;
    const orgName = orgRow?.name?.trim() || 'Your cleaning company';
    const message = inviteEmail({
      orgName,
      url: actionLink,
      brandColor: orgRow?.brand_color ?? null,
      logoUrl: orgRow?.logo_icon_url ?? null,
    });
    // White-label sender: the inbox row shows the org's name (address stays EMAIL_FROM).
    await sendEmail({ to: email, fromName: orgName, ...message });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
