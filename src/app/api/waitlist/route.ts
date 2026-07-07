import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_SIZES = new Set(['solo', '2-5', '6-10', '11-25', '25+']);

/**
 * Early-access waitlist signup from the marketing landing page. Public
 * (no auth). Idempotent: a duplicate email returns the same success shape as
 * a fresh insert so the endpoint never leaks who is already on the list.
 */
export async function POST(request: NextRequest) {
  let payload: { email?: unknown; companyName?: unknown; teamSize?: unknown };
  try {
    payload = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required' }, { status: 400 });
  }

  let companyName: string | null = null;
  if (payload.companyName != null) {
    if (typeof payload.companyName !== 'string' || payload.companyName.length > 200) {
      return NextResponse.json({ ok: false, error: 'Company name is too long' }, { status: 400 });
    }
    companyName = payload.companyName.trim() || null;
  }

  let teamSize: string | null = null;
  if (payload.teamSize != null) {
    if (typeof payload.teamSize !== 'string' || !TEAM_SIZES.has(payload.teamSize)) {
      return NextResponse.json({ ok: false, error: 'Unknown team size' }, { status: 400 });
    }
    teamSize = payload.teamSize;
  }

  const { error } = await supabaseAdmin.from('waitlist_signups').insert({
    email,
    company_name: companyName,
    team_size: teamSize,
    source: 'landing',
  });

  if (error && error.code !== '23505') {
    console.error('waitlist insert failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not save signup' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
