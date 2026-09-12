import { asRecord, isUuid, parseOptionalText, parseRequiredText, type ParseResult } from '@/lib/catalog/parse';

export interface PropertyCreateInput {
  organization_id: string;
  owner_id: string | null;
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

/** Absent, null, or '' become null; otherwise a finite number of 0 or more (whole when `integer`). */
function parseOptionalNumber(v: unknown, label: string, integer: boolean): ParseResult<number | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  const n = typeof v === 'string' ? Number(v) : v;
  const whole = integer ? 'a whole number' : 'a number';
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
    return { ok: false, error: `${label} must be ${whole} of 0 or more` };
  }
  return { ok: true, value: n };
}

export function parsePropertyCreate(body: unknown): ParseResult<PropertyCreateInput> {
  const r = asRecord(body);
  if (!r) return { ok: false, error: 'Request body must be a JSON object' };
  if (!isUuid(r.organization_id)) return { ok: false, error: 'organization_id is required' };

  let ownerId: string | null = null;
  if (r.owner_id !== undefined && r.owner_id !== null) {
    if (!isUuid(r.owner_id)) return { ok: false, error: 'owner_id must be an id' };
    ownerId = r.owner_id;
  }

  const name = parseRequiredText(r.name, 'Property name', 200);
  if (!name.ok) return name;
  const address = parseRequiredText(r.address, 'Address', 300);
  if (!address.ok) return address;
  const city = parseRequiredText(r.city, 'City', 120);
  if (!city.ok) return city;
  const state = parseRequiredText(r.state, 'State', 50);
  if (!state.ok) return state;
  const zip = parseRequiredText(r.zip_code, 'ZIP code', 20);
  if (!zip.ok) return zip;

  const bedrooms = parseOptionalNumber(r.bedrooms, 'Bedrooms', true);
  if (!bedrooms.ok) return bedrooms;
  const bathrooms = parseOptionalNumber(r.bathrooms, 'Bathrooms', false);
  if (!bathrooms.ok) return bathrooms;
  const squareFeet = parseOptionalNumber(r.square_feet, 'Square feet', true);
  if (!squareFeet.ok) return squareFeet;

  const special = parseOptionalText(r.special_instructions, 'Special instructions');
  if (!special.ok) return special;
  const access = parseOptionalText(r.access_instructions, 'Access instructions');
  if (!access.ok) return access;

  return {
    ok: true,
    value: {
      organization_id: r.organization_id,
      owner_id: ownerId,
      name: name.value,
      address: address.value,
      city: city.value,
      state: state.value,
      zip_code: zip.value,
      bedrooms: bedrooms.value,
      bathrooms: bathrooms.value,
      square_feet: squareFeet.value,
      special_instructions: special.value,
      access_instructions: access.value,
    },
  };
}
