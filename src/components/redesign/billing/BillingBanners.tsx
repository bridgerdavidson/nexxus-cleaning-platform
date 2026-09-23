'use client'

// Steps 2 to 4 of the severity ladder (ruling R13): the caution banner as the
// trial closes, and the persistent, non-dismissible bar (ruling R14) an
// organization lives under once its access is frozen, or once its last
// payment has failed. Exactly one banner renders at a time; the choice is
// made once, in billingBanner (billingBannersModel.ts), and this file only
// renders the answer.
//
// Mounted in OperatorShell right after RedesignImpersonationBanner: a
// platform admin viewing as a tenant needs to know that first.

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShellBanner, type ShellBannerTone } from '@/components/ui/shell-banner'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/hooks/useAuth'
import { useBilling } from '@/hooks/useBilling'
import { keys } from '@/lib/queryKeys'
import { extendTrial, getPortalUrl } from './billing-api'
import { billingBanner, type BannerAction, type BannerActionKind } from './billingBannersModel'
import { openPaywall } from './usePaywall'

const EXTEND_ERROR = 'Could not extend your trial. Please try again.'
const PORTAL_ERROR = 'Could not open the billing portal. Please try again.'

const TONE_ICON: Record<ShellBannerTone, React.ReactNode> = {
  neutral: <Info />,
  info: <Info />,
  caution: <AlertTriangle />,
  critical: <Ban />,
}

export function BillingBanners(): React.JSX.Element | null {
  const { uiEnabled, access, isOwner, canSeeBillingChrome, billing } = useBilling()
  const { currentOrganizationId } = useAuth()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [pending, setPending] = React.useState<BannerActionKind | null>(null)

  const orgId = currentOrganizationId ?? ''

  const spec = billingBanner({
    uiEnabled,
    access,
    isOwner,
    canSeeBillingChrome,
    pauseResumesAt: billing?.billing_pause_resumes_at ?? null,
  })

  if (!spec) return null

  async function handleExtend(): Promise<void> {
    setPending('extend')
    try {
      await extendTrial(orgId)
      await queryClient.invalidateQueries({ queryKey: keys.billing.all })
    } catch {
      showToast(EXTEND_ERROR, { variant: 'error' })
    } finally {
      setPending(null)
    }
  }

  async function handleUpdatePayment(): Promise<void> {
    setPending('update-payment')
    try {
      const url = await getPortalUrl(orgId, window.location.href)
      window.location.href = url
    } catch {
      showToast(PORTAL_ERROR, { variant: 'error' })
      setPending(null)
    }
  }

  function handleAction(action: BannerAction): void {
    if (action.kind === 'extend') void handleExtend()
    else if (action.kind === 'choose-plan') openPaywall()
    else if (action.kind === 'update-payment') void handleUpdatePayment()
  }

  return (
    <ShellBanner
      tone={spec.tone}
      icon={TONE_ICON[spec.tone]}
      // No onDismiss, ever: every banner this ladder can produce is
      // non-dismissible (ruling R14). A message about an unresolved problem
      // should not vanish on a click.
      actions={
        spec.actions.length ? (
          <>
            {spec.actions.map((action) => (
              <Button
                key={action.kind}
                size="sm"
                variant={action.variant}
                loading={pending === action.kind}
                onClick={() => handleAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </>
        ) : undefined
      }
    >
      {spec.message}
    </ShellBanner>
  )
}
