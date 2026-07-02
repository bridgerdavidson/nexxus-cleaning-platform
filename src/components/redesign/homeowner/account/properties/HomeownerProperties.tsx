'use client';

import { useState } from 'react';
import { useHomeownerProperties } from '@/hooks/useHomeownerData';
import { useOpenProperty } from './useOpenProperty';
import { HomeownerPropertiesView } from './HomeownerPropertiesView';
import { PropertyFormSheet } from './PropertyFormSheet';
import { HomeownerPropertyDetailHost } from './HomeownerPropertyDetailHost';

/**
 * Homeowner Properties: list + add (create) + a ?property= detail takeover that
 * owns edit/delete. Reads useHomeownerProperties (realtime-synced); mutations
 * invalidate the query so the list refreshes.
 */
export function HomeownerProperties() {
  const { properties, loading } = useHomeownerProperties();
  const openProperty = useOpenProperty();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <HomeownerPropertiesView
        properties={properties}
        loading={loading}
        onOpen={openProperty}
        onAdd={() => setAddOpen(true)}
      />
      <PropertyFormSheet open={addOpen} onOpenChange={setAddOpen} onSaved={() => {}} />
      <HomeownerPropertyDetailHost />
    </>
  );
}
