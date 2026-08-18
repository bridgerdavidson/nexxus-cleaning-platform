import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { recoveryEmail } from '@/lib/email/templates/recoveryEmail';
import { triggerPasswordReset } from '@/lib/auth/passwordReset';
import { isAuthEmailSendFailure } from '@/lib/monitoring/authEmailHealth';

export type RecoveryDeliveryResult =
  | { ok: true }
  | { ok: false; failure: { status: number | null; code: string | null; message: string } };

/**
 * Deliver the password-recovery email, org-branded (counterpart of
 * inviteDelivery.ts for the forgot-password flow).
 *
 * With SMTP configured: mint the recovery action link (admin.generateLink type
 * 'recovery' sends nothing) and deliver it through the Brevo transport with
 * the user's org as sender name, color, and logo; a user with no org
 * membership (platform staff) gets the neutral Nexxus look. Without SMTP:
 * fall back to GoTrue's own mailer via triggerPasswordReset, unchanged.
 *
 * Anti-enumeration is preserved on both paths: an unknown email resolves
 * ok:true (GoTrue short-circuits it; generateLink's user-not-found error is
 * swallowed here), and callers must always return a generic success to the
 * client. ok:false means a genuine provider/SMTP problem the platform owner
 * should be paged about (the caller records the alert), classified with the
 * same isAuthEmailSendFailure rules as before so rate limits and validation
 * errors never page.
 */
export async function deliverRecoveryEmail({
  email,
  redirectTo,
}: {
  email: string;
  redirectTo?: string;
}): Promise<RecoveryDeliveryResult> {
  if (!emailConfigured()) {
    const { error } = await triggerPasswordReset(email, redirectTo);
    if (isAuthEmailSendFailure(error)) {
      return {
        ok: false,
        failure: {
          status: error?.status ?? null,
          code: (error as { code?: string } | null)?.code ?? null,
          message: error?.message ?? 'send failed',
        },
      };
    }
    return { ok: true };
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (linkError) {
    // user_not_found (404) and client errors stay silent (anti-enumeration /
    // caller's problem); only genuine provider or config failures page.
    if (isAuthEmailSendFailure(linkError)) {
      return {
        ok: false,
        failure: {
          status: linkError.status ?? null,
          code: (linkError as { code?: string }).code ?? null,
          message: linkError.message ?? 'generateLink failed',
        },
      };
    }
    return { ok: true };
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) {
    return {
      ok: false,
      failure: { status: null, code: null, message: 'no recovery link returned' },
    };
  }

  try {
    // Brand as the user's org (first membership, same rule as AuthContext).
    let orgName: string | null = null;
    let brandColor: string | null = null;
    let logoUrl: string | null = null;
    const userId = linkData.user?.id;
    if (userId) {
      const { data: membership } = await supabaseAdmin
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      const organizationId = (membership as { organization_id?: string } | null)?.organization_id;
      if (organizationId) {
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
        orgName = orgRow?.name?.trim() || null;
        brandColor = orgRow?.brand_color ?? null;
        logoUrl = orgRow?.logo_icon_url ?? null;
      }
    }

    const message = recoveryEmail({ orgName, url: actionLink, brandColor, logoUrl });
    // White-label sender when the user belongs to an org; EMAIL_FROM verbatim otherwise.
    await sendEmail({ to: email, ...(orgName ? { fromName: orgName } : {}), ...message });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      failure: {
        status: null,
        code: 'smtp_send_failed',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
