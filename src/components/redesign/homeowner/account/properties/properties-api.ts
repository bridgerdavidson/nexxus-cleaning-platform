import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { Property } from '@/hooks/useHomeownerData';

export interface CreatePropertyBody {
  organization_id: string;
  /** Operators name the homeowner; a homeowner caller is always the owner and may omit this. */
  owner_id?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  special_instructions: string | null;
  access_instructions: string | null;
}

export const createPropertyApi = (body: CreatePropertyBody): Promise<ApiResult<Property>> =>
  apiFetch<Property>('/api/properties', { method: 'POST', body });
