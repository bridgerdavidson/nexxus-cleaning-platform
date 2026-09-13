'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { compareChecklists } from '../lib/checklistOrder';
import { Checklist, ChecklistLineItem, ChecklistWithItems } from '../types';
import {
  createChecklistApi,
  createLineItemsApi,
  deleteChecklistApi,
  deleteLineItemApi,
  reorderLineItemsApi,
  updateChecklistApi,
  updateLineItemApi,
} from './checklists-api';

interface UseChecklistsResult {
  checklists: ChecklistWithItems[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  applyLineItemUpdated: (lineItemId: string, task: string) => void;
  applyLineItemAdded: (checklistId: string, item: ChecklistLineItem) => void;
  applyLineItemRemoved: (lineItemId: string) => void;
  applyLineItemsReordered: (checklistId: string, orderedItems: ChecklistLineItem[]) => void;
  applyChecklistUpdated: (checklistId: string, name: string, priceAdder: number) => void;
  applyChecklistAdded: (checklist: ChecklistWithItems) => void;
}

/**
 * Hook to fetch checklists and their line items for a given service type.
 * Returns checklists with nested checklist_line_items array.
 */
export function useChecklists(serviceTypeId: string | null): UseChecklistsResult {
  const queryClient = useQueryClient();
  const queryKey = keys.checklists.byServiceType(serviceTypeId ?? '');

  const query = useQuery({
    queryKey,
    enabled: !!serviceTypeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklists')
        .select(`
          *,
          checklist_line_items (*)
        `)
        .eq('service_type_id', serviceTypeId as string)
        .order('price_adder', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

      if (error) throw error;

      const checklistsWithItems = (data || []) as ChecklistWithItems[];
      // Tiers in the locked canonical order: cheapest first, ties by creation
      // (see compareChecklists). The server already ordered; re-sorting keeps
      // cache patches (applyChecklistAdded/Updated) on the same rule.
      checklistsWithItems.sort(compareChecklists);
      checklistsWithItems.forEach((checklist) => {
        if (checklist.checklist_line_items) {
          checklist.checklist_line_items.sort((a, b) => {
            if (a.position === null && b.position === null) {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            }
            if (a.position === null) return 1;
            if (b.position === null) return -1;
            if (a.position !== b.position) return a.position - b.position;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });
        }
      });
      return checklistsWithItems;
    },
  });

  // Live checklists scoped to the active service type.
  useSupabaseRealtimeSync({
    channelName: `checklists:${serviceTypeId ?? ''}`,
    table: 'checklists',
    filter: serviceTypeId ? `service_type_id=eq.${serviceTypeId}` : undefined,
    enabled: !!serviceTypeId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  // checklist_line_items carries only checklist_id (no service_type_id), so we
  // can't DB-filter by the active service type. Subscribe unfiltered + invalidate
  // the active query; RLS applies, and refetch re-reads only this service type's
  // checklists. Local edits still use the applyLineItem* helpers for instant UI.
  useSupabaseRealtimeSync({
    channelName: `checklist_line_items:${serviceTypeId ?? ''}`,
    table: 'checklist_line_items',
    enabled: !!serviceTypeId,
    onEvent: () => ({ type: 'invalidate', keys: [queryKey] }),
  });

  const updateCache = useCallback(
    (updater: (prev: ChecklistWithItems[]) => ChecklistWithItems[]) => {
      queryClient.setQueryData<ChecklistWithItems[]>(queryKey, prev => updater(prev ?? []));
    },
    [queryClient, queryKey]
  );

  const applyLineItemUpdated = useCallback(
    (lineItemId: string, task: string) => {
      updateCache(prev =>
        prev.map(checklist => ({
          ...checklist,
          checklist_line_items: checklist.checklist_line_items?.map(item =>
            item.id === lineItemId ? { ...item, task } : item
          ),
        }))
      );
    },
    [updateCache]
  );

  const applyLineItemAdded = useCallback(
    (checklistId: string, item: ChecklistLineItem) => {
      updateCache(prev =>
        prev.map(checklist =>
          checklist.id === checklistId
            ? {
                ...checklist,
                checklist_line_items: [...(checklist.checklist_line_items || []), item],
              }
            : checklist
        )
      );
    },
    [updateCache]
  );

  const applyLineItemRemoved = useCallback(
    (lineItemId: string) => {
      updateCache(prev =>
        prev.map(checklist => ({
          ...checklist,
          checklist_line_items: checklist.checklist_line_items?.filter(item => item.id !== lineItemId),
        }))
      );
    },
    [updateCache]
  );

  const applyLineItemsReordered = useCallback(
    (checklistId: string, orderedItems: ChecklistLineItem[]) => {
      updateCache(prev =>
        prev.map(checklist =>
          checklist.id === checklistId
            ? { ...checklist, checklist_line_items: orderedItems }
            : checklist
        )
      );
    },
    [updateCache]
  );

  const applyChecklistUpdated = useCallback(
    (checklistId: string, name: string, priceAdder: number) => {
      updateCache(prev =>
        prev
          .map(checklist =>
            checklist.id === checklistId ? { ...checklist, name, price_adder: priceAdder } : checklist
          )
          .sort(compareChecklists)
      );
    },
    [updateCache]
  );

  const applyChecklistAdded = useCallback(
    (checklist: ChecklistWithItems) => {
      updateCache(prev => [...prev, checklist].sort(compareChecklists));
    },
    [updateCache]
  );

  return {
    checklists: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: () => {
      query.refetch();
    },
    applyLineItemUpdated,
    applyLineItemAdded,
    applyLineItemRemoved,
    applyLineItemsReordered,
    applyChecklistUpdated,
    applyChecklistAdded,
  };
}

// ============================================================================
// CHECKLIST CRUD FUNCTIONS (writes go through the API routes; reads stay direct)
// ============================================================================

/** Create a new checklist for a service type. */
export async function createChecklist(
  serviceTypeId: string,
  name: string = 'New Checklist',
  priceAdder: number = 0
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  const res = await createChecklistApi(serviceTypeId, { name: name.trim() || 'New Checklist', price_adder: priceAdder });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/** Update a checklist's name and price adder. */
export async function updateChecklist(
  checklistId: string,
  name: string,
  priceAdder: number
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  if (!name.trim()) return { success: false, error: 'Checklist name cannot be empty' };
  const res = await updateChecklistApi(checklistId, { name: name.trim(), price_adder: priceAdder });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/** Delete a checklist (line items are cascade deleted). */
export async function deleteChecklist(
  checklistId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await deleteChecklistApi(checklistId);
  return res.success ? { success: true } : { success: false, error: res.error };
}

// ============================================================================
// LINE ITEM CRUD FUNCTIONS
// ============================================================================

/** Create a new line item in a checklist. */
export async function createLineItem(
  checklistId: string,
  task: string
): Promise<{ success: boolean; data?: ChecklistLineItem; error?: string }> {
  if (!task.trim()) return { success: false, error: 'Task cannot be empty' };
  const res = await createLineItemsApi(checklistId, { task: task.trim() });
  return res.success ? { success: true, data: res.data[0] } : { success: false, error: res.error };
}

/** Update a line item's task text. */
export async function updateLineItem(
  lineItemId: string,
  task: string
): Promise<{ success: boolean; data?: ChecklistLineItem; error?: string }> {
  if (!task.trim()) return { success: false, error: 'Task cannot be empty' };
  const res = await updateLineItemApi(lineItemId, { task: task.trim() });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/** Delete a line item. */
export async function deleteLineItem(
  lineItemId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await deleteLineItemApi(lineItemId);
  return res.success ? { success: true } : { success: false, error: res.error };
}

/** Reorder line items in a checklist. `orderedIds` must be every item exactly once. */
export async function reorderLineItems(
  checklistId: string,
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const res = await reorderLineItemsApi(checklistId, orderedIds);
  return res.success ? { success: true } : { success: false, error: res.error };
}

/**
 * Bulk-create line items from pasted text. Each non-blank line becomes one task,
 * appended after existing items (position stays NULL so they sort last by created_at).
 */
export async function createLineItems(
  checklistId: string,
  tasks: string[]
): Promise<{ success: boolean; data?: ChecklistLineItem[]; error?: string }> {
  const cleaned = tasks.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return { success: false, error: 'No tasks to add' };
  const res = await createLineItemsApi(checklistId, { tasks: cleaned });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

/**
 * Clone a checklist (tier) within the same service, including all its line items
 * in order. The source is read here (reads stay direct); the copy is created by
 * the checklist route, so the copy is named "<name> (copy)" and carries the
 * source's price, which places it right after the source in the locked order.
 */
export async function duplicateChecklist(
  checklistId: string
): Promise<{ success: boolean; data?: ChecklistWithItems; error?: string }> {
  const { data: source, error: srcError } = await supabase
    .from('checklists')
    .select('*, checklist_line_items (*)')
    .eq('id', checklistId)
    .single();
  if (srcError || !source) {
    return { success: false, error: srcError?.message ?? 'Checklist not found' };
  }
  const src = source as ChecklistWithItems;
  const items = [...(src.checklist_line_items ?? [])].sort((a, b) => {
    if (a.position === null && b.position === null) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return (a.position ?? 0) - (b.position ?? 0);
  });
  const res = await createChecklistApi(src.service_type_id, {
    name: `${src.name} (copy)`,
    price_adder: Number(src.price_adder) || 0,
    items: items.map((it) => it.task),
  });
  return res.success ? { success: true, data: res.data } : { success: false, error: res.error };
}

export type { Checklist, ChecklistLineItem, ChecklistWithItems };
