'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { updateProperty } from '@/hooks/useAdminData';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import type { Property } from '@/hooks/useHomeownerData';
import { PropertyPhotoField } from './PropertyPhotoField';
import {
  EMPTY_PROPERTY_FORM,
  toNumberOrNull,
  validateProperty,
  type PropertyFormValues,
} from './validateProperty';

function fromProperty(p: Property): PropertyFormValues {
  return {
    name: p.name ?? '',
    address: p.address ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    zip_code: p.zip_code ?? '',
    bedrooms: p.bedrooms != null ? String(p.bedrooms) : '',
    bathrooms: p.bathrooms != null ? String(p.bathrooms) : '',
    square_feet: p.square_feet != null ? String(p.square_feet) : '',
    special_instructions: p.special_instructions ?? '',
    access_instructions: p.access_instructions ?? '',
  };
}

function LabeledInput({
  id,
  label,
  value,
  onChange,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.ComponentProps<typeof Input>, 'id' | 'value' | 'onChange'>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-muted-foreground">
        {label}
      </label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}

export interface PropertyFormSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Present = edit mode; absent = add mode. */
  property?: Property | null;
  onSaved: () => void;
}

export function PropertyFormSheet({ open, onOpenChange, property, onSaved }: PropertyFormSheetProps) {
  const { user, currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();
  const isEdit = !!property;

  const [form, setForm] = useState<PropertyFormValues>(EMPTY_PROPERTY_FORM);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset the form each time the sheet opens (from the property in edit mode).
  useEffect(() => {
    if (!open) return;
    setForm(property ? fromProperty(property) : EMPTY_PROPERTY_FORM);
    setPhotoUrl(property?.photo_url ?? null);
    setError(null);
  }, [open, property]);

  const set = (k: keyof PropertyFormValues) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function onSave() {
    const err = validateProperty(form);
    if (err) {
      setError(err);
      return;
    }
    if (!user?.id || !currentOrganizationId) {
      setError('You are signed out. Please sign in again.');
      return;
    }
    setError(null);
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      zip_code: form.zip_code.trim(),
      bedrooms: toNumberOrNull(form.bedrooms),
      bathrooms: toNumberOrNull(form.bathrooms),
      square_feet: toNumberOrNull(form.square_feet),
      special_instructions: form.special_instructions.trim() || null,
      access_instructions: form.access_instructions.trim() || null,
    };

    try {
      if (isEdit && property) {
        const res = await updateProperty(property.id, { ...payload, photo_url: photoUrl });
        if (!res.success) throw new Error(res.error ?? 'Could not save the property.');
      } else {
        const { error: insertError } = await supabase.from('properties').insert({
          ...payload,
          owner_id: user.id,
          organization_id: currentOrganizationId,
        });
        if (insertError) throw new Error(insertError.message);
      }
      await queryClient.invalidateQueries({ queryKey: keys.properties.byHomeowner(user.id) });
      toast.success(isEdit ? 'Property updated' : 'Property added');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the property.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{isEdit ? 'Edit property' : 'Add property'}</DrawerTitle>
        </DrawerHeader>

        <div className="max-h-[70dvh] space-y-4 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {isEdit && property && (
            <PropertyPhotoField
              propertyId={property.id}
              currentPhotoUrl={photoUrl}
              onUploaded={setPhotoUrl}
            />
          )}

          <LabeledInput id="pf-name" label="Property name" value={form.name} onChange={set('name')} placeholder="Main house" />
          <LabeledInput id="pf-address" label="Street address" value={form.address} onChange={set('address')} autoComplete="address-line1" />
          <div className="flex gap-3">
            <div className="flex-1">
              <LabeledInput id="pf-city" label="City" value={form.city} onChange={set('city')} autoComplete="address-level2" />
            </div>
            <div className="w-20">
              <LabeledInput id="pf-state" label="State" value={form.state} onChange={set('state')} autoComplete="address-level1" />
            </div>
            <div className="w-24">
              <LabeledInput id="pf-zip" label="ZIP" value={form.zip_code} onChange={set('zip_code')} inputMode="numeric" autoComplete="postal-code" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <LabeledInput id="pf-bd" label="Beds" value={form.bedrooms} onChange={set('bedrooms')} inputMode="numeric" />
            </div>
            <div className="flex-1">
              <LabeledInput id="pf-ba" label="Baths" value={form.bathrooms} onChange={set('bathrooms')} inputMode="numeric" />
            </div>
            <div className="flex-1">
              <LabeledInput id="pf-sqft" label="Sq ft" value={form.square_feet} onChange={set('square_feet')} inputMode="numeric" />
            </div>
          </div>
          <div>
            <label htmlFor="pf-special" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Special requests
            </label>
            <Textarea id="pf-special" value={form.special_instructions} onChange={(e) => set('special_instructions')(e.target.value)} rows={2} placeholder="Anything our cleaners should know" />
          </div>
          <div>
            <label htmlFor="pf-access" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Access instructions
            </label>
            <Textarea id="pf-access" value={form.access_instructions} onChange={(e) => set('access_instructions')(e.target.value)} rows={2} placeholder="Gate code, key location, parking" />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-control border border-critical/30 bg-critical-50 px-3 py-2 text-sm text-critical-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <Button onClick={onSave} loading={saving} className="w-full">
              {isEdit ? 'Save changes' : 'Add property'}
            </Button>
            <Button variant="ghost" className="w-full" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
