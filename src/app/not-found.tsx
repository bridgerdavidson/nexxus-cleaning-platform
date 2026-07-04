'use client'

import { SystemStatePage, type SystemStateAction } from '@/components/redesign/shared/SystemStatePage'
import { useAuth } from '@/hooks/useAuth'
import { getDashboardPath } from '@/lib/redesign/dashboardPath'
import { redesignUiEnabled } from '@/lib/redesign/flags'

export default function NotFound() {
  const { user } = useAuth()
  const actions: SystemStateAction[] = [{ label: 'Back to home', href: '/', variant: 'primary' }]
  if (user?.role) {
    actions.push({
      label: 'Go to your dashboard',
      href: getDashboardPath(user.role, { redesign: redesignUiEnabled() }),
      variant: 'outline',
    })
  }
  return (
    <SystemStatePage
      eyebrow="Error 404"
      title="We couldn't find that page"
      description="The page you're looking for moved or never existed. Let's get you back on track."
      actions={actions}
    />
  )
}
