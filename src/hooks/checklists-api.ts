import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { Checklist, ChecklistLineItem, ChecklistWithItems } from '@/types';

export const createChecklistApi = (
  serviceTypeId: string,
  body: { name: string; price_adder: number; items?: string[] },
): Promise<ApiResult<ChecklistWithItems>> =>
  apiFetch<ChecklistWithItems>(`/api/services/${serviceTypeId}/checklists`, { method: 'POST', body });

export const updateChecklistApi = (
  checklistId: string,
  body: { name?: string; price_adder?: number },
): Promise<ApiResult<Checklist>> =>
  apiFetch<Checklist>(`/api/checklists/${checklistId}`, { method: 'PATCH', body });

export const deleteChecklistApi = (checklistId: string): Promise<ApiResult<void>> =>
  apiFetch<void>(`/api/checklists/${checklistId}`, { method: 'DELETE' });

export const createLineItemsApi = (
  checklistId: string,
  body: { task: string } | { tasks: string[] },
): Promise<ApiResult<ChecklistLineItem[]>> =>
  apiFetch<ChecklistLineItem[]>(`/api/checklists/${checklistId}/items`, { method: 'POST', body });

export const updateLineItemApi = (itemId: string, body: { task: string }): Promise<ApiResult<ChecklistLineItem>> =>
  apiFetch<ChecklistLineItem>(`/api/checklist-items/${itemId}`, { method: 'PATCH', body });

export const deleteLineItemApi = (itemId: string): Promise<ApiResult<void>> =>
  apiFetch<void>(`/api/checklist-items/${itemId}`, { method: 'DELETE' });

export const reorderLineItemsApi = (checklistId: string, itemIds: string[]): Promise<ApiResult<ChecklistLineItem[]>> =>
  apiFetch<ChecklistLineItem[]>(`/api/checklists/${checklistId}/items/order`, {
    method: 'PUT',
    body: { item_ids: itemIds },
  });
