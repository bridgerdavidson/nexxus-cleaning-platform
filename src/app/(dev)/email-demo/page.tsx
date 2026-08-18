'use client'

/**
 * Email template gallery (dev + preview only, gated by the (dev) layout).
 *
 * Renders the transactional-email builders into iframes so template changes
 * can be reviewed visually without sending anything. This is the visual
 * regression specimen for the shared shell (src/lib/email/templates/shell.ts):
 * if a template drifts off-system, it shows here first.
 *
 * Client component on purpose: hosted brand images resolve from APP_URL in
 * production, so the demo substitutes window.location.origin to show the same
 * images from this dev server's /public.
 *
 * receiptEmail and cardLinkEmail still render their pre-shell look; they adopt
 * the shell in a later pass and join this gallery then.
 */

import { useEffect, useState } from 'react'
import { ownerProvisionEmail } from '@/lib/email/templates/ownerProvisionEmail'
import { inviteEmail } from '@/lib/email/templates/inviteEmail'
import { recoveryEmail } from '@/lib/email/templates/recoveryEmail'

const SAMPLE_URL =
  'https://example.supabase.co/auth/v1/verify?token=sample&type=invite&redirect_to=https%3A%2F%2Fcleaning.trynexxus.com%2Faccept-invite%3Finvite_id%3Dsample'

function Specimen({
  title,
  sender,
  subject,
  html,
  height,
}: {
  title: string
  sender: string
  subject: string
  html: string
  height: number
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">
          From: <span className="font-semibold text-foreground">{sender}</span>
          {' · '}Subject: <span className="font-semibold text-foreground">{subject}</span>
        </p>
      </div>
      <iframe
        title={title}
        srcDoc={html}
        style={{ height }}
        className="w-full max-w-[640px] rounded-card border border-border bg-card"
      />
    </section>
  )
}

export default function EmailDemoPage() {
  // Origin is only known client-side; render nothing until mounted so the
  // specimens never flash the no-image fallback.
  const [origin, setOrigin] = useState<string | null>(null)
  useEffect(() => setOrigin(window.location.origin), [])
  if (!origin) return null

  const provision = ownerProvisionEmail({
    orgName: 'Nexxus Corporate Housing',
    url: SAMPLE_URL,
    assetBaseUrl: origin,
  })
  const provisionNoAssets = ownerProvisionEmail({
    orgName: 'Nexxus Corporate Housing',
    url: SAMPLE_URL,
    assetBaseUrl: null,
  })
  const inviteBranded = inviteEmail({
    orgName: 'Sparkles Cleaning',
    url: SAMPLE_URL,
    brandColor: '#D500F4',
    logoUrl: `${origin}/brand/icon-color.png`,
  })
  const invitePlain = inviteEmail({ orgName: 'Sparkles Cleaning', url: SAMPLE_URL })
  const recoveryOrg = recoveryEmail({
    orgName: 'Sparkles Cleaning',
    url: SAMPLE_URL,
    brandColor: '#D500F4',
  })
  const recoveryNeutral = recoveryEmail({ orgName: null, url: SAMPLE_URL })

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-5 py-10">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Email templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rendered from the real builders with sample data. Brand images load from this server.
        </p>
      </div>

      <Specimen
        title="Owner provision (platform voice)"
        sender="Nexxus"
        subject={provision.subject}
        html={provision.html}
        height={860}
      />
      <Specimen
        title="Owner provision, no APP_URL (text-lockup fallback)"
        sender="Nexxus"
        subject={provisionNoAssets.subject}
        html={provisionNoAssets.html}
        height={860}
      />
      <Specimen
        title="Member invite, org-branded (white label)"
        sender="Sparkles Cleaning"
        subject={inviteBranded.subject}
        html={inviteBranded.html}
        height={620}
      />
      <Specimen
        title="Member invite, no org branding set"
        sender="Sparkles Cleaning"
        subject={invitePlain.subject}
        html={invitePlain.html}
        height={620}
      />
      <Specimen
        title="Password recovery, org-branded (pre-shell look, restyle queued)"
        sender="Sparkles Cleaning"
        subject={recoveryOrg.subject}
        html={recoveryOrg.html}
        height={560}
      />
      <Specimen
        title="Password recovery, neutral (pre-shell look, restyle queued)"
        sender="Nexxus"
        subject={recoveryNeutral.subject}
        html={recoveryNeutral.html}
        height={560}
      />
    </main>
  )
}
