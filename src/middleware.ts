import { NextRequest, NextResponse } from 'next/server'

// Host-based routing for the marketing subdomain (get.jobber-style). When
// MARKETING_HOST is set (e.g. "get.cleaning.tri-nexus.com") and a request for
// "/" arrives on that host, serve the landing page instead of the app's 404.
// With MARKETING_HOST unset this is a pass-through no-op, and the matcher is
// scoped to "/" so app routes are never touched either way.
export function middleware(request: NextRequest) {
  const marketingHost = process.env.MARKETING_HOST
  if (!marketingHost) return NextResponse.next()

  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase()
  if (host === marketingHost.toLowerCase()) {
    return NextResponse.rewrite(new URL('/landing', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/',
}
