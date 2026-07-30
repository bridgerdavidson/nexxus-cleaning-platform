'use client'

import * as React from 'react'
import { FullPageLoader } from '@/components/ui/nexxus-loader'

/**
 * Dev-only stage for the FullPageLoader. The real auth guards resolve too
 * fast to eyeball the animation, so this page holds it on screen forever.
 * Reloading exercises the hydration-mount path (the scenario that froze the
 * old SMIL version); clicking remounts the loader to replay the first
 * draw-in cycle without a reload.
 */
export default function LoaderDemoPage() {
  const [run, setRun] = React.useState(0)

  return (
    <div onClick={() => setRun((n) => n + 1)} className="cursor-pointer">
      <FullPageLoader key={run} />
      <p className="pointer-events-none fixed inset-x-0 bottom-4 text-center text-xs text-muted-foreground">
        Click anywhere to replay the draw-in. Reload to test a fresh hydration mount.
      </p>
    </div>
  )
}
