'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSupabaseRealtimeSync } from '../lib/useSupabaseRealtimeSync';
import { keys } from '../lib/queryKeys';
import { compareChecklists } from '../lib/checklistOrder';
import { Checklist, ChecklistLineItem, ChecklistWithItems } from '../types';

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
// CHECKLIST CRUD FUNCTIONS
// ============================================================================

/**
 * Create a new checklist for a service type
 */
export async function createChecklist(
  serviceTypeId: string,
  name: string = 'New Checklist',
  priceAdder: number = 0
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('checklists')
      .insert({
        service_type_id: serviceTypeId,
        name: name.trim() || 'New Checklist',
        price_adder: priceAdder,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error creating checklist:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create checklist',
    };
  }
}

/**
 * Update a checklist's name
 */
export async function updateChecklist(
  checklistId: string,
  name: string,
  priceAdder: number
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  try {
    if (!name.trim()) {
      return { success: false, error: 'Checklist name cannot be empty' };
    }

    const { data, error } = await supabase
      .from('checklists')
      .update({ name: name.trim(), price_adder: priceAdder })
      .eq('id', checklistId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error updating checklist:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update checklist',
    };
  }
}

/**
 * Delete a checklist (line items are cascade deleted)
 */
export async function deleteChecklist(
  checklistId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('checklists')
      .delete()
      .eq('id', checklistId);

    if (error) {
      throw error;
    }

    return { success: true };
  } catch (err) {
    console.error('Error deleting checklist:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete checklist',
    };
  }
}

// ============================================================================
// LINE ITEM CRUD FUNCTIONS
// ============================================================================

/**
 * Create a new line item in a checklist
 */
export async function createLineItem(
  checklistId: string,
  task: string
): Promise<{ success: boolean; data?: ChecklistLineItem; error?: string }> {
  try {
    if (!task.trim()) {
      return { success: false, error: 'Task cannot be empty' };
    }

    const { data, error } = await supabase
      .from('checklist_line_items')
      .insert({
        checklist_id: checklistId,
        task: task.trim(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error creating line item:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create line item',
    };
  }
}

/**
 * Update a line item's task text
 */
export async function updateLineItem(
  lineItemId: string,
  task: string
): Promise<{ success: boolean; data?: ChecklistLineItem; error?: string }> {
  try {
    if (!task.trim()) {
      return { success: false, error: 'Task cannot be empty' };
    }

    const { data, error } = await supabase
      .from('checklist_line_items')
      .update({ task: task.trim() })
      .eq('id', lineItemId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return { success: true, data };
  } catch (err) {
    console.error('Error updating line item:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update line item',
    };
  }
}

/**
 * Delete a line item
 */
export async function deleteLineItem(
  lineItemId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('checklist_line_items')
      .delete()
      .eq('id', lineItemId);

    if (error) {
      throw error;
    }

    return { success: true };
  } catch (err) {
    console.error('Error deleting line item:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to delete line item',
    };
  }
}

/**
 * Reorder line items in a checklist
 * Updates the position of each line item based on the order of ids provided
 */
export async function reorderLineItems(
  checklistId: string,
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    // Update each line item's position sequentially to avoid request storms/timeouts.
    const results: {
      status: number;
      statusText: string;
      count: number | null;
      error: { code?: string; message?: string } | null;
    }[] = [];

    for (const [index, id] of orderedIds.entries()) {
      const result = await supabase
        .from('checklist_line_items')
        .update({ position: index })
        .eq('id', id)
        .eq('checklist_id', checklistId); // Ensure the item belongs to this checklist
      results.push(result);
    }

    // Check if any updates failed
    const failedUpdate = results.find((result) => result.error);
    if (failedUpdate?.error) {
      throw failedUpdate.error;
    }

    return { success: true };
  } catch (err) {
    console.error('Error reordering line items:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to reorder line items',
    };
  }
}

/**
 * Bulk-create line items from pasted text. Each non-blank line becomes one task,
 * appended after existing items (position left NULL so they sort last by created_at).
 */
export async function createLineItems(
  checklistId: string,
  tasks: string[]
): Promise<{ success: boolean; data?: ChecklistLineItem[]; error?: string }> {
  try {
    const rows = tasks
      .map((t) => t.trim())
      .filter(Boolean)
      .map((task) => ({ checklist_id: checklistId, task }));
    if (rows.length === 0) return { success: false, error: 'No tasks to add' };

    const { data, error } = await supabase
      .from('checklist_line_items')
      .insert(rows)
      .select();
    if (error) throw error;
    return { success: true, data: (data ?? []) as ChecklistLineItem[] };
  } catch (err) {
    console.error('Error bulk-creating line items:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to add tasks' };
  }
}

/**
 * Clone a checklist (tier) within the same service, including all its line items
 * in order. The copy is named "<name> (copy)" and carries the source's price, so
 * the locked order places it right after the source (creation time breaks the tie).
 */
export async function duplicateChecklist(
  checklistId: string
): Promise<{ success: boolean; data?: ChecklistWithItems; error?: string }> {
  try {
    const { data: source, error: srcError } = await supabase
      .from('checklists')
      .select('*, checklist_line_items (*)')
      .eq('id', checklistId)
      .single();
    if (srcError) throw srcError;

    const src = source as ChecklistWithItems;
    const { data: created, error: createError } = await supabase
      .from('checklists')
      .insert({
        service_type_id: src.service_type_id,
        name: `${src.name} (copy)`,
        price_adder: src.price_adder,
      })
      .select()
      .single();
    if (createError) throw createError;

    const items = [...(src.checklist_line_items ?? [])].sort((a, b) => {
      if (a.position === null && b.position === null) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      return (a.position ?? 0) - (b.position ?? 0);
    });

    let clonedItems: ChecklistLineItem[] = [];
    if (items.length > 0) {
      const { data: inserted, error: itemsError } = await supabase
        .from('checklist_line_items')
        .insert(items.map((it, idx) => ({ checklist_id: created.id, task: it.task, position: idx })))
        .select();
      if (itemsError) throw itemsError;
      clonedItems = (inserted ?? []) as ChecklistLineItem[];
    }

    return { success: true, data: { ...(created as Checklist), checklist_line_items: clonedItems } };
  } catch (err) {
    console.error('Error duplicating checklist:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to duplicate checklist' };
  }
}

export type { Checklist, ChecklistLineItem, ChecklistWithItems };
