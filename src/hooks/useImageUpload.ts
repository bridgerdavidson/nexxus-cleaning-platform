'use client';

import { useCallback, useRef, useState } from 'react';
import { uploadOne, isTransientError } from '../lib/image-upload/uploadOne';
import { uuidv4 } from '../lib/uuid';
import type {
  UploadCompleteSummary,
  UploadContext,
  UploadFailure,
  UploadItem,
  UploadStatus,
  UploadSuccess,
} from '../lib/image-upload/types';

const DEFAULT_CONCURRENCY = 3;

interface UseImageUploadOptions {
  context: UploadContext;
  concurrency?: number;
  onComplete?: (summary: UploadCompleteSummary) => void;
}

interface UseImageUploadResult {
  items: UploadItem[];
  start: (files: File[]) => void;
  retryFailed: () => void;
  reset: () => void;
  isWorking: boolean;
}

/**
 * React-facing hook for batch image uploads. Owns the per-file state machine
 * (queued → converting → compressing → uploading → done|failed), a concurrency
 * queue, and one-shot auto-retry on transient failures. Callers render the UI
 * off `items`.
 */
export function useImageUpload(options: UseImageUploadOptions): UseImageUploadResult {
  const { context, concurrency = DEFAULT_CONCURRENCY, onComplete } = options;

  // `itemsRef` is the synchronous source of truth that the queue reads. We
  // mutate it before `setItems` so `runItem` can always find an item by id,
  // regardless of React's update batching.
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const activeRef = useRef(0);
  const queueRef = useRef<string[]>([]);
  const contextRef = useRef(context);
  contextRef.current = context;

  // Stable refs for runItem/pump so they don't form a circular useCallback
  // dependency. runItem reads `pumpRef.current()` at call time.
  const runItemRef = useRef<(id: string) => Promise<void>>(async () => {});
  const pumpRef = useRef<() => void>(() => {});

  const writeItems = useCallback((next: UploadItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<UploadItem>) => {
      const next = itemsRef.current.map(it => (it.id === id ? { ...it, ...patch } : it));
      writeItems(next);
    },
    [writeItems],
  );

  const maybeFinish = useCallback(() => {
    if (activeRef.current > 0 || queueRef.current.length > 0) return;
    const finalItems = itemsRef.current;
    const stillWorking = finalItems.some(it => it.status !== 'done' && it.status !== 'failed');
    if (stillWorking) return;

    const uploaded: UploadSuccess[] = finalItems
      .filter(it => it.status === 'done' && it.url)
      .map(it => ({ id: it.id, url: it.url!, rowId: it.rowId }));
    const failed: UploadFailure[] = finalItems
      .filter(it => it.status === 'failed')
      .map(it => ({ id: it.id, fileName: it.file.name, message: it.error ?? 'Upload failed.' }));

    onComplete?.({ uploaded, failed });
  }, [onComplete]);

  // Define runItem via ref so it can call pumpRef without a circular dep.
  runItemRef.current = async (id: string) => {
    const item = itemsRef.current.find(it => it.id === id);
    if (!item) {
      // Item vanished (reset). Free the slot we reserved in pump.
      activeRef.current -= 1;
      pumpRef.current();
      maybeFinish();
      return;
    }

    const onStatusChange = (status: UploadStatus) => updateItem(id, { status });

    try {
      const result = await uploadOne(item.file, contextRef.current, { onStatusChange });
      updateItem(id, { status: 'done', url: result.url, rowId: result.rowId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      const current = itemsRef.current.find(it => it.id === id);
      if (current && current.attempt === 0 && isTransientError(err)) {
        updateItem(id, { attempt: 1, status: 'queued', error: undefined });
        queueRef.current.push(id);
      } else {
        updateItem(id, { status: 'failed', error: message });
      }
    } finally {
      activeRef.current -= 1;
      pumpRef.current();
      maybeFinish();
    }
  };

  pumpRef.current = () => {
    while (activeRef.current < concurrency && queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      activeRef.current += 1;
      void runItemRef.current(next);
    }
  };

  const start = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const newItems: UploadItem[] = files.map(file => ({
        id: uuidv4(),
        file,
        status: 'queued',
        attempt: 0,
      }));

      writeItems([...itemsRef.current, ...newItems]);
      for (const it of newItems) queueRef.current.push(it.id);
      pumpRef.current();
    },
    [writeItems],
  );

  const retryFailed = useCallback(() => {
    const failedIds = itemsRef.current.filter(it => it.status === 'failed').map(it => it.id);
    if (failedIds.length === 0) return;

    const next = itemsRef.current.map(it =>
      it.status === 'failed'
        ? { ...it, status: 'queued' as const, attempt: 0 as const, error: undefined }
        : it,
    );
    writeItems(next);
    for (const id of failedIds) queueRef.current.push(id);
    pumpRef.current();
  }, [writeItems]);

  const reset = useCallback(() => {
    queueRef.current = [];
    activeRef.current = 0;
    writeItems([]);
  }, [writeItems]);

  const isWorking = items.some(it => it.status !== 'done' && it.status !== 'failed');

  return { items, start, retryFailed, reset, isWorking };
}
