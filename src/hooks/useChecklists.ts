'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Checklist, ChecklistLineItem, ChecklistWithItems } from '../types';

interface UseChecklistsResult {
  checklists: ChecklistWithItems[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
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
      
      // Sort line items within each checklist by created_at
      checklistsWithItems.forEach((checklist) => {
        if (checklist.checklist_line_items) {
          checklist.checklist_line_items.sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
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

  return {
    checklists,
    loading,
    error,
    refetch,
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
  name: string = 'New Checklist'
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('checklists')
      .insert({
        service_type_id: serviceTypeId,
        name: name.trim() || 'New Checklist',
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
  name: string
): Promise<{ success: boolean; data?: Checklist; error?: string }> {
  try {
    if (!name.trim()) {
      return { success: false, error: 'Checklist name cannot be empty' };
    }

    const { data, error } = await supabase
      .from('checklists')
      .update({ name: name.trim() })
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

export type { Checklist, ChecklistLineItem, ChecklistWithItems };
