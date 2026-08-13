import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import {
  checklistToggleMutationOptions,
  type ToggleChecklistVars,
} from './toggleChecklist';
import { keys } from '../queryKeys';

/**
 * Headless reproduction of the rapid-tap regression: a cleaner taps checklist
 * items top-to-bottom faster than the network round trip, and items that were
 * optimistically ticked visually uncheck themselves when an earlier tap's
 * settle-triggered refetch lands with a server snapshot that predates the
 * later taps.
 *
 * The fake server models PostgREST semantics: a read captures its snapshot
 * when the request STARTS, but the response arrives whenever the test releases
 * it — exactly how a stale in-flight response overtakes newer local state.
 */

const APPT = 'appt-1';
const key = keys.appointments.checklistCompletions(APPT);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let promise chains and TanStack internals settle. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

class FakeChecklistServer {
  state = new Set<string>();
  private writes: Array<{ vars: ToggleChecklistVars; d: Deferred<void> }> = [];
  private reads: Array<{ snapshot: Set<string>; d: Deferred<Set<string>> }> = [];

  write = (vars: ToggleChecklistVars): Promise<void> => {
    const d = deferred<void>();
    this.writes.push({ vars, d });
    return d.promise.then(() => {
      if (vars.done) this.state.add(vars.lineItemId);
      else this.state.delete(vars.lineItemId);
    });
  };

  read = (): Promise<Set<string>> => {
    const d = deferred<Set<string>>();
    this.reads.push({ snapshot: new Set(this.state), d });
    return d.promise;
  };

  releaseWrite(i: number): void {
    this.writes[i].d.resolve();
  }

  failWrite(i: number, err: Error): void {
    this.writes[i].d.reject(err);
  }

  /** Deliver every outstanding read response with its start-time snapshot. */
  releaseReads(): void {
    for (const r of this.reads.splice(0)) {
      r.d.resolve(r.snapshot);
    }
  }

  get readRequestCount(): number {
    return this.totalReads;
  }

  private totalReads = 0;

  constructor() {
    const origRead = this.read;
    this.read = () => {
      this.totalReads += 1;
      return origRead();
    };
  }
}

describe('checklistToggleMutationOptions', () => {
  let qc: QueryClient;
  let server: FakeChecklistServer;
  let observer: QueryObserver<Set<string>>;
  let unsubscribe: () => void;

  const cache = () => qc.getQueryData<Set<string>>(key);

  function tap(lineItemId: string, done = true): Promise<unknown> {
    const m = new MutationObserver(
      qc,
      checklistToggleMutationOptions(qc, server.write),
    );
    return m.mutate({ appointmentId: APPT, lineItemId, done }).catch(() => {
      // Failure paths are asserted via cache state, not the returned promise.
    });
  }

  beforeEach(() => {
    server = new FakeChecklistServer();
    qc = new QueryClient({
      defaultOptions: {
        // Mirror src/lib/queryClient.ts where it matters for this flow.
        queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
        mutations: { retry: 0 },
      },
    });
    qc.setQueryData<Set<string>>(key, new Set());
    // An active observer, like the mounted checklist screen — invalidations
    // trigger real refetches against the fake server.
    observer = new QueryObserver<Set<string>>(qc, {
      queryKey: key,
      queryFn: server.read,
    });
    unsubscribe = observer.subscribe(() => {});
  });

  afterEach(() => {
    unsubscribe();
    qc.clear();
  });

  it('keeps later optimistic ticks when an earlier tap settles and refetches', async () => {
    tap('item-1');
    await flush();
    tap('item-2');
    await flush();

    // Both taps applied optimistically.
    expect(cache()).toEqual(new Set(['item-1', 'item-2']));

    // item-1's write commits while item-2's is still in flight. Any refetch
    // started now snapshots the server WITHOUT item-2.
    server.releaseWrite(0);
    await flush();
    server.releaseReads();
    await flush();

    // The regression: the stale snapshot lands and visually unchecks item-2.
    expect(cache()).toEqual(new Set(['item-1', 'item-2']));

    // After the last write settles everything converges.
    server.releaseWrite(1);
    await flush();
    server.releaseReads();
    await flush();
    expect(cache()).toEqual(new Set(['item-1', 'item-2']));
  });

  it('refetches only after the LAST in-flight toggle settles', async () => {
    tap('item-1');
    await flush();
    tap('item-2');
    await flush();
    tap('item-3');
    await flush();

    server.releaseWrite(0);
    await flush();
    server.releaseWrite(1);
    await flush();
    expect(server.readRequestCount).toBe(0);

    server.releaseWrite(2);
    await flush();
    expect(server.readRequestCount).toBe(1);

    server.releaseReads();
    await flush();
    expect(cache()).toEqual(new Set(['item-1', 'item-2', 'item-3']));
  });

  it('rolls back only the failed item, preserving other in-flight ticks', async () => {
    tap('item-1');
    await flush();
    tap('item-2');
    await flush();
    expect(cache()).toEqual(new Set(['item-1', 'item-2']));

    server.failWrite(0, new Error('network blip'));
    await flush();

    // Only item-1 reverts; item-2's optimistic tick must survive.
    expect(cache()).toEqual(new Set(['item-2']));

    server.releaseWrite(1);
    await flush();
    server.releaseReads();
    await flush();
    expect(cache()).toEqual(new Set(['item-2']));
  });

  it('handles a plain single toggle round trip (tick, settle, refetch)', async () => {
    tap('item-1');
    await flush();
    expect(cache()).toEqual(new Set(['item-1']));

    server.releaseWrite(0);
    await flush();
    expect(server.readRequestCount).toBe(1);
    server.releaseReads();
    await flush();
    expect(cache()).toEqual(new Set(['item-1']));
  });

  it('handles untick: removes optimistically and persists the delete', async () => {
    qc.setQueryData<Set<string>>(key, new Set(['item-1']));
    server.state.add('item-1');

    tap('item-1', false);
    await flush();
    expect(cache()).toEqual(new Set());

    server.releaseWrite(0);
    await flush();
    server.releaseReads();
    await flush();
    expect(cache()).toEqual(new Set());
  });
});
