'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlatformStatCards } from './PlatformStatCards';
import { TenantRoster } from './TenantRoster';
import { ProvisionTenantDialog } from './ProvisionTenantDialog';

/** Platform overview: header + Provision action, the KPI row, and the tenant roster. */
export function PlatformOverview() {
  const [showProvision, setShowProvision] = useState(false);

  return (
    <div className="max-w-[1700px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tenants</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every cleaning company on Nexxus.</p>
        </div>
        <Button onClick={() => setShowProvision(true)} className="shrink-0">
          <Plus /> Provision tenant
        </Button>
      </header>

      <PlatformStatCards />
      <TenantRoster />

      <ProvisionTenantDialog open={showProvision} onOpenChange={setShowProvision} />
    </div>
  );
}
