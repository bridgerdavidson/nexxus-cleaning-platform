'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
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
  const [checklists, setChecklists] = useState<ChecklistWithItems[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChecklists = useCallback(async () => {
    if (!serviceTypeId) {
      setChecklists([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch checklists with their line items using Supabase's nested select
      const { data, error: fetchError } = await supabase
        .from('checklists')
        .select(`
          *,
          checklist_line_items (*)
        `)
        .eq('service_type_id', serviceTypeId)
        .order('name', { ascending: true });

      if (fetchError) {
        throw fetchError;
      }

      // Type assertion since Supabase returns the nested data
      const checklistsWithItems = (data || []) as ChecklistWithItems[];
      
      // Sort line items within each checklist by position (nulls last), then created_at
      checklistsWithItems.forEach((checklist) => {
        if (checklist.checklist_line_items) {
          checklist.checklist_line_items.sort((a, b) => {
            // Handle null positions - nulls sort last
            if (a.position === null && b.position === null) {
              return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            }
            if (a.position === null) return 1;
            if (b.position === null) return -1;
            
            // Both have positions - sort by position, then created_at for ties
            if (a.position !== b.position) {
              return a.position - b.position;
            }
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });
        }
      });

      setChecklists(checklistsWithItems);
    } catch (err) {
      console.error('Error fetching checklists:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch checklists');
    } finally {
      setLoading(false);
    }
  }, [serviceTypeId]);

  useEffect(() => {
    fetchChecklists();
  }, [fetchChecklists]);

  const refetch = useCallback(() => {
    fetchChecklists();
  }, [fetchChecklists]);

  // Local state updaters - update in-memory state without refetching
  const applyLineItemUpdated = useCallback((lineItemId: string, task: string) => {
    setChecklists((prev) =>
      prev.map((checklist) => ({
        ...checklist,
        checklist_line_items: checklist.checklist_line_items?.map((item) =>
          item.id === lineItemId ? { ...item, task } : item
        ),
      }))
    );
  }, []);

  const applyLineItemAdded = useCallback((checklistId: string, item: ChecklistLineItem) => {
    setChecklists((prev) =>
      prev.map((checklist) =>
        checklist.id === checklistId
          ? {
              ...checklist,
              checklist_line_items: [...(checklist.checklist_line_items || []), item],
            }
          : checklist
      )
    );
  }, []);

  const applyLineItemRemoved = useCallback((lineItemId: string) => {
    setChecklists((prev) =>
      prev.map((checklist) => ({
        ...checklist,
        checklist_line_items: checklist.checklist_line_items?.filter(
          (item) => item.id !== lineItemId
        ),
      }))
    );
  }, []);

  const applyLineItemsReordered = useCallback((checklistId: string, orderedItems: ChecklistLineItem[]) => {
    setChecklists((prev) =>
      prev.map((checklist) =>
        checklist.id === checklistId
          ? {
              ...checklist,
              checklist_line_items: orderedItems,
            }
          : checklist
      )
    );
  }, []);

  const applyChecklistUpdated = useCallback((checklistId: string, name: string, priceAdder: number) => {
    setChecklists((prev) =>
      prev.map((checklist) =>
        checklist.id === checklistId ? { ...checklist, name, price_adder: priceAdder } : checklist
      )
    );
  }, []);

  const applyChecklistAdded = useCallback((checklist: ChecklistWithItems) => {
    setChecklists((prev) => [...prev, checklist].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  return {
    checklists,
    loading,
    error,
    refetch,
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
    // Update each line item's position based on its index in orderedIds
    const updates = orderedIds.map((id, index) =>
      supabase
        .from('checklist_line_items')
        .update({ position: index })
        .eq('id', id)
        .eq('checklist_id', checklistId) // Ensure the item belongs to this checklist
    );

    // Execute all updates in parallel
    const results = await Promise.all(updates);

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

export type { Checklist, ChecklistLineItem, ChecklistWithItems };
