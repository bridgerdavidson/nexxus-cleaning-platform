import { createClient } from '@supabase/supabase-js';
import { withGatewayRetry } from './gatewayRetryFetch';

// Server-side admin client - NEVER expose to client
// Use a singleton pattern to reuse the same client instance
let supabaseAdminInstance: ReturnType<typeof createClient> | null = null;

export const supabaseAdmin = (() => {
  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        global: {
          headers: {
            'x-application-name': 'nexxus-cleaning-platform'
          },
          // Retries a read once on a transient gateway 502/503/504 (see gatewayRetryFetch.ts).
          fetch: withGatewayRetry()
        }
      }
    );
  }
  return supabaseAdminInstance;
})();
