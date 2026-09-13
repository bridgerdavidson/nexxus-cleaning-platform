import { asRecord, isUuid, parseMoney, type ParseResult } from './parse';

export const CHECKLIST_NAME_MAX = 120;

export interface ChecklistCreateInput { name: string; price_adder: number; items: string[] }
export interface ChecklistUpdateInput { name?: string; price_adder?: number }
export interface ItemsCreateInput { tasks: string[] }
export interface ItemUpdateInput { task: string }
export interface OrderInput { item_ids: string[] }

const NOT_OBJECT = { ok: false as const, error: 'Request body must be a JSON object' };

function parseTasks(v: unknown): ParseResult<string[]> {
  if (!Array.isArray(v) || v.some((t) => typeof t !== 'string')) {
    return { ok: false, error: 'Checklist items must be text' };
  }
  return { ok: true, value: (v as string[]).map((t) => t.trim()).filter(Boolean) };
}

function checkNameLength(name: string): ParseResult<string> {
  if (name.length > CHECKLIST_NAME_MAX) {
    return { ok: false, error: `Checklist name must be ${CHECKLIST_NAME_MAX} characters or fewer` };
  }
  return { ok: true, value: name };
}

/** A blank or absent name becomes "New Checklist", matching the old createChecklist default. */
export function parseChecklistCreate(body: unknown): ParseResult<ChecklistCreateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  const rawName = typeof r.name === 'string' ? r.name.trim() : '';
  const name = checkNameLength(rawName || 'New Checklist');
  if (!name.ok) return name;
  const price = parseMoney(r.price_adder ?? 0, 'Checklist price');
  if (!price.ok) return price;
  const items = parseTasks(r.items ?? []);
  if (!items.ok) return items;
  return { ok: true, value: { name: name.value, price_adder: price.value, items: items.value } };
}

export function parseChecklistUpdate(body: unknown): ParseResult<ChecklistUpdateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  const value: ChecklistUpdateInput = {};
  if (r.name !== undefined) {
    const trimmed = typeof r.name === 'string' ? r.name.trim() : '';
    if (!trimmed) return { ok: false, error: 'Checklist name cannot be empty' };
    const name = checkNameLength(trimmed);
    if (!name.ok) return name;
    value.name = name.value;
  }
  if (r.price_adder !== undefined) {
    const price = parseMoney(r.price_adder, 'Checklist price');
    if (!price.ok) return price;
    value.price_adder = price.value;
  }
  if (Object.keys(value).length === 0) return { ok: false, error: 'No valid fields to update' };
  return { ok: true, value };
}

/** `{ task }` for one item, `{ tasks }` for many. Wording matches the old client functions. */
export function parseItemsCreate(body: unknown): ParseResult<ItemsCreateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  if (r.tasks !== undefined) {
    const tasks = parseTasks(r.tasks);
    if (!tasks.ok) return tasks;
    if (tasks.value.length === 0) return { ok: false, error: 'No tasks to add' };
    return { ok: true, value: { tasks: tasks.value } };
  }
  const task = typeof r.task === 'string' ? r.task.trim() : '';
  if (!task) return { ok: false, error: 'Task cannot be empty' };
  return { ok: true, value: { tasks: [task] } };
}

export function parseItemUpdate(body: unknown): ParseResult<ItemUpdateInput> {
  const r = asRecord(body);
  if (!r) return NOT_OBJECT;
  const task = typeof r.task === 'string' ? r.task.trim() : '';
  if (!task) return { ok: false, error: 'Task cannot be empty' };
  return { ok: true, value: { task } };
}

export function parseOrder(body: unknown): ParseResult<OrderInput> {
  const r = asRecord(body);
  const ids = r?.item_ids;
  const bad = { ok: false as const, error: 'item_ids must be a list of unique item ids' };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isUuid)) return bad;
  if (new Set(ids).size !== ids.length) return bad;
  return { ok: true, value: { item_ids: ids as string[] } };
}

/** True when `itemIds` is a permutation of `existingIds`. */
export function orderMatchesItems(itemIds: string[], existingIds: string[]): boolean {
  if (itemIds.length !== existingIds.length) return false;
  const want = new Set(existingIds);
  return itemIds.every((id) => want.has(id));
}
