import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { ChecklistSeed } from '@/lib/catalog/serviceInput';
import type { ServiceType, UpdateServiceData } from './useServices';

export interface CreateServiceBody {
  organization_id: string;
  name: string;
  description?: string | null;
  base_price: number;
  duration_minutes: number;
  service_type: string;
  is_active?: boolean;
  /** Present only when cloning: replaces the trigger-seeded default checklist. */
  checklists?: ChecklistSeed[];
}

export const createServiceApi = (body: CreateServiceBody): Promise<ApiResult<ServiceType>> =>
  apiFetch<ServiceType>('/api/services', { method: 'POST', body });

export const updateServiceApi = (serviceId: string, body: UpdateServiceData): Promise<ApiResult<ServiceType>> =>
  apiFetch<ServiceType>(`/api/services/${serviceId}`, { method: 'PATCH', body });

export const deleteServiceApi = (serviceId: string): Promise<ApiResult<void>> =>
  apiFetch<void>(`/api/services/${serviceId}`, { method: 'DELETE' });
