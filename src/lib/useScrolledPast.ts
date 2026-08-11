'use client'

import * as React from 'react'

/**
 * True once the window has scrolled past `threshold` px. The listener is
 * passive and only ever sets a boolean, so scrolling never re-renders per
 * frame; state flips exactly at the crossing (React bails on same-value sets).
 */
export function useScrolledPast(threshold: number): boolean {
  const [past, setPast] = React.useState(false)
  React.useEffect(() => {
    const onScroll = () => setPast(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return past
}
