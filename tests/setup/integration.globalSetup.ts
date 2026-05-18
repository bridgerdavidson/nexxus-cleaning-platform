import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads a dotenv-style file into `process.env`. `override` controls whether
 * existing values get clobbered (true for `.env.test.local`, which must beat
 * Vite's auto-loaded `.env.test` stubs).
 */
function loadDotenvFile(path: string, override: boolean): void {
  if (!existsSync(path)) return;
  let text = readFileSync(path, 'utf8');
  // Strip UTF-8 BOM if present (Windows PowerShell loves to add one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export default async function globalSetup() {
  // .env.test.local overrides anything already in process.env (e.g. the
  // stub values Vite auto-loads from .env.test). Then .env.test fills in
  // any keys that weren't set elsewhere.
  loadDotenvFile(resolve(process.cwd(), '.env.test.local'), true);
  loadDotenvFile(resolve(process.cwd(), '.env.test'), false);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey || !anonKey || url === 'http://stub.invalid') {
    throw new Error(
      [
        'Integration tests require a running local Supabase instance.',
        '',
        'Missing env vars:',
        `  NEXT_PUBLIC_SUPABASE_URL=${url ?? '(unset)'}`,
        `  NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey ? '(set)' : '(unset)'}`,
        `  SUPABASE_SERVICE_ROLE_KEY=${serviceKey ? '(set)' : '(unset)'}`,
        '',
        'Run `npx supabase start` then write the values to .env.test.local.',
        'Hint: `npx supabase status --output json` prints them in machine-readable form.',
      ].join('\n'),
    );
  }

  const healthUrl = `${url.replace(/\/$/, '')}/auth/v1/health`;
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { headers: { apikey: anonKey } });
      if (res.ok) return;
      lastError = new Error(`Supabase health check returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Supabase at ${url} did not become ready within 60s. Last error: ${String(lastError)}\n` +
      'Did you run `npx supabase start`?',
  );
}
