'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global error]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F7F6F3',
          color: '#211E1A',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: '4rem 1.5rem',
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#0150FC', margin: 0 }}>
          Something went wrong
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '12px 0 0' }}>This one&rsquo;s on us</h1>
        <p style={{ maxWidth: 340, color: '#6B6459', margin: '12px 0 0', lineHeight: 1.5 }}>
          A part of the app failed to load. Try again, and if it keeps happening, let us know.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          <button
            onClick={() => reset()}
            style={{ height: 48, padding: '0 24px', borderRadius: 999, border: 'none', background: '#0150FC', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{ height: 48, padding: '0 24px', display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1px solid #E6E2DB', color: '#211E1A', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
          >
            Back to home
          </a>
        </div>
      </body>
    </html>
  )
}
