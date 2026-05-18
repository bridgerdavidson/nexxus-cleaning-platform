// Unit test setup: no infra.
// Lock timezone to UTC so date-based assertions don't drift on developer machines or CI.
process.env.TZ = 'UTC';

import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.clearAllMocks();
});
