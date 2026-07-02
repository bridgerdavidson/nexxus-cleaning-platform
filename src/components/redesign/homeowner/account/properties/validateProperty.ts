export interface PropertyFormValues {
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: string;
  bathrooms: string;
  square_feet: string;
  special_instructions: string;
  access_instructions: string;
}

export const EMPTY_PROPERTY_FORM: PropertyFormValues = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip_code: '',
  bedrooms: '',
  bathrooms: '',
  square_feet: '',
  special_instructions: '',
  access_instructions: '',
};

/** Returns an error message for the first missing required field, or null when valid. */
export function validateProperty(v: PropertyFormValues): string | null {
  if (!v.name.trim()) return 'Give this property a name.';
  if (!v.address.trim()) return 'Enter the street address.';
  if (!v.city.trim()) return 'Enter the city.';
  if (!v.state.trim()) return 'Enter the state.';
  if (!v.zip_code.trim()) return 'Enter the ZIP code.';
  return null;
}

/** Parses a numeric text field to a number, or null when blank/invalid. */
export function toNumberOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
