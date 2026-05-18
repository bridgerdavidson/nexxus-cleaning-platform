import { NextRequest } from 'next/server';

export function bearerHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export interface CallRouteInit {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface CallRouteResult<T = unknown> {
  status: number;
  body: T;
  raw: Response;
}

/**
 * Invoke a Next.js App Router handler directly. No HTTP server, no port.
 *
 * Usage:
 *   import { POST } from '@/app/api/admin/delete-team-member/route';
 *   const res = await callRoute(POST, { method: 'DELETE', body: { ... }, headers: { ... } });
 */
export async function callRoute<T = unknown>(
  handler: (req: NextRequest) => Promise<Response> | Response,
  init: CallRouteInit,
): Promise<CallRouteResult<T>> {
  const url = init.url ?? 'http://test.local/api/handler';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers ?? {}),
  };
  const requestInit: Record<string, unknown> = {
    method: init.method,
    headers,
  };
  if (init.body !== undefined && init.method !== 'GET') {
    requestInit.body =
      typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    requestInit.duplex = 'half';
  }
  // NextRequest's RequestInit type is narrower than the standard one (omits duplex);
  // cast through `unknown` because we know `duplex: 'half'` is required at runtime
  // whenever a body is present and is the correct Node-fetch contract.
  const req = new NextRequest(url, requestInit as unknown as ConstructorParameters<typeof NextRequest>[1]);
  const res = await handler(req);
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T, raw: res };
}
