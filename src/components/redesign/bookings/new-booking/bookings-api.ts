import { apiFetch, type ApiResult } from '@/lib/auth/apiFetch';
import type { BookingInsert } from './buildBookingInsert';

export interface CreateBookingBody {
  organization_id: string;
  appointment: BookingInsert['appointment'];
  slots: BookingInsert['slots'];
}

export const createBookingApi = (body: CreateBookingBody): Promise<ApiResult<{ id: string }>> =>
  apiFetch<{ id: string }>('/api/appointments', { method: 'POST', body });
