import { asRecord, isUuid, parseMoney, parseOptionalText, parseRequiredText, type ParseResult } from './parse';

export const SERVICE_NAME_MAX = 120;

export interface ChecklistSeed {
  name: string;
  price_adder: number;
  position: number | null;
  items: string[];
}

export interface ServiceCreateInput {
  organization_id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
  service_type: string;
  is_active: boolean;
  /**
   * undefined: keep the trigger-seeded "Default Checklist" (plain create).
   * An array, even empty: replace the seeded checklist with these (duplicate).
   */
  checklists?: ChecklistSeed[];
}

export interface ServiceUpdateInput {
  name?: string;
  description?: string | null;
  base_price?: number;
  duration_minutes?: number;
  service_type?: string;
  is_active?: boolean;
}

function parseDuration(v: unknown): ParseResult<number> {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    return { ok: false, error: 'Duration must be a whole number of minutes greater than 0' };
  }
  return { ok: true, value: n };
}

function parseServiceType(v: unknown): ParseResult<string> {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: 'Service type is required' };
  return { ok: true, value: v.trim() };
}

function parseIsActive(v: unknown): ParseResult<boolean> {
  if (typeof v !== 'boolean') return { ok: false, error: 'is_active must be true or false' };
  return { ok: true, value: v };
}

export function parseChecklistSeeds(v: unknown): ParseResult<ChecklistSeed[]> {
  if (!Array.isArray(v)) return { ok: false, error: 'checklists must be an array' };
  const out: ChecklistSeed[] = [];
  for (const raw of v) {
    const r = asRecord(raw);
    if (!r) return { ok: false, error: 'Each checklist must be an object' };
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'New Checklist';
    const adder = parseMoney(r.price_adder ?? 0, 'Checklist price');
    if (!adder.ok) return adder;
    const position = r.position === undefined || r.position === null ? null : Number(r.position);
    if (position !== null && !Number.isInteger(position)) {
      return { ok: false, error: 'Checklist position must be a whole number' };
    }
    const itemsRaw = r.items ?? [];
    if (!Array.isArray(itemsRaw) || itemsRaw.some((t) => typeof t !== 'string')) {
      return { ok: false, error: 'Checklist items must be text' };
    }
    const items = (itemsRaw as string[]).map((t) => t.trim()).filter(Boolean);
    out.push({ name, price_adder: adder.value, position, items });
  }
  return { ok: true, value: out };
}

export function parseServiceCreate(body: unknown): ParseResult<ServiceCreateInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  if (!isUuid(r.organization_id)) return { ok: false, error: 'organization_id is required' };
  const name = parseRequiredText(r.name, 'Service name', SERVICE_NAME_MAX);
  if (!name.ok) return name;
  const description = parseOptionalText(r.description, 'Description');
  if (!description.ok) return description;
  const basePrice = parseMoney(r.base_price, 'Base price');
  if (!basePrice.ok) return basePrice;
  const duration = parseDuration(r.duration_minutes);
  if (!duration.ok) return duration;
  const serviceType = parseServiceType(r.service_type);
  if (!serviceType.ok) return serviceType;
  let isActive = true;
  if (r.is_active !== undefined) {
    const p = parseIsActive(r.is_active);
    if (!p.ok) return p;
    isActive = p.value;
  }
  const value: ServiceCreateInput = {
    organization_id: r.organization_id,
    name: name.value,
    description: description.value,
    base_price: basePrice.value,
    duration_minutes: duration.value,
    service_type: serviceType.value,
    is_active: isActive,
  };
  if (r.checklists !== undefined) {
    const seeds = parseChecklistSeeds(r.checklists);
    if (!seeds.ok) return seeds;
    value.checklists = seeds.value;
  }
  return { ok: true, value };
}

export function parseServiceUpdate(body: unknown): ParseResult<ServiceUpdateInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  const value: ServiceUpdateInput = {};
  if (r.name !== undefined) {
    const p = parseRequiredText(r.name, 'Service name', SERVICE_NAME_MAX);
    if (!p.ok) return p;
    value.name = p.value;
  }
  if (r.description !== undefined) {
    const p = parseOptionalText(r.description, 'Description');
    if (!p.ok) return p;
    value.description = p.value;
  }
  if (r.base_price !== undefined) {
    const p = parseMoney(r.base_price, 'Base price');
    if (!p.ok) return p;
    value.base_price = p.value;
  }
  if (r.duration_minutes !== undefined) {
    const p = parseDuration(r.duration_minutes);
    if (!p.ok) return p;
    value.duration_minutes = p.value;
  }
  if (r.service_type !== undefined) {
    const p = parseServiceType(r.service_type);
    if (!p.ok) return p;
    value.service_type = p.value;
  }
  if (r.is_active !== undefined) {
    const p = parseIsActive(r.is_active);
    if (!p.ok) return p;
    value.is_active = p.value;
  }
  if (Object.keys(value).length === 0) return { ok: false, error: 'No valid fields to update' };
  return { ok: true, value };
}
