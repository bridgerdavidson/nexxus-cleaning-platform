import { NextResponse, type NextRequest } from 'next/server';

const DASHBOARD_ROUTES = [
  '/admin-dashboard',
  '/manager-dashboard',
  '/cleaner-dashboard',
  '/homeowner-dashboard',
];

// Known section ids → /settings/<section>. Anything else falls back to /settings.
const SECTION_REDIRECTS: Record<string, string> = {
  profile: '/settings/profile',
  payments: '/settings/payments',
  billing: '/settings/payments', // legacy alias from SettingsHub
  payouts: '/settings/payouts',
  'cancellation-policy': '/settings/cancellation-policy',
  security: '/settings/security',
  notifications: '/settings/notifications',
};

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Legacy ?tab=settings on any dashboard → 307 to the new /settings/* route.
  // 307 (temporary) — the dashboard URL itself is still valid for any other tab value.
  if (
    DASHBOARD_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/')) &&
    searchParams.get('tab') === 'settings'
  ) {
    const section = searchParams.get('section');
    const target = section ? SECTION_REDIRECTS[section] ?? '/settings' : '/settings';
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = '';
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
