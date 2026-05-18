import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Load .env.test + .env.test.local from disk *at config time*, so the values
// are baked into each project's `env` map before any worker spins up.
// Required for integration: `src/lib/supabase-admin.ts` reads env at module
// import time (top-level IIFE) inside the worker. If env isn't right at
// worker boot, the singleton points at stub URLs and every DB call fails.
const integrationEnv = loadEnv('test', process.cwd(), '');

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/lib/appointments/**',
        'src/lib/auth/**',
        'src/app/api/admin/delete-team-member/**',
        'src/app/api/appointments/confirm/**',
        'src/app/api/stripe/create-payment-intent/**',
        'src/app/api/stripe/webhook/**',
        'src/app/api/payments/record/**',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.integration.test.ts', 'src/**/*.integration.test.tsx', 'node_modules/**', '.next/**'],
          setupFiles: ['./tests/setup/unit.setup.ts'],
          env: {
            NEXT_PUBLIC_SUPABASE_URL: 'http://stub.invalid',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stub-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role-key',
            STRIPE_ENABLED: 'false',
            NEXT_PUBLIC_STRIPE_ENABLED: 'false',
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['./tests/setup/integration.globalSetup.ts'],
          setupFiles: ['./tests/setup/integration.setup.ts'],
          fileParallelism: false,
          poolOptions: { threads: { singleThread: true } },
          testTimeout: 30_000,
          hookTimeout: 30_000,
          env: integrationEnv,
        },
      },
    ],
  },
});
