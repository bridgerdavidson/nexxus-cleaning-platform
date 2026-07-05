'use client'

import { useEffect } from 'react'
import { SystemStatePage } from '@/components/redesign/shared/SystemStatePage'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app error boundary]', error)
  }, [error])

  return (
    <SystemStatePage
      eyebrow="Something went wrong"
      title="This one's on us"
      description="A part of the app failed to load. Try again, and if it keeps happening, let us know."
      actions={[
        { label: 'Try again', onClick: () => reset(), variant: 'primary' },
        { label: 'Back to home', href: '/', variant: 'outline' },
      ]}
    />
  )
}
