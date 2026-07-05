'use client';

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';
import { HomeownerPaymentMethodsView } from './HomeownerPaymentMethodsView';
import { AddCardSheet } from './AddCardSheet';
import { RemoveCardSheet } from './RemoveCardSheet';
import { useSavedPaymentMethods } from './useSavedPaymentMethods';
import { paymentMethodTitle, type SavedPaymentMethod } from './derive-payment-methods';

/**
 * Saved payment methods for the authenticated homeowner: list, set-default, remove, and add
 * (Stripe SetupIntent). Behind the new-charge-flow UI flag; when off, the whole area shows a
 * graceful "unavailable" state (the hub already hides the entry, but the route is reachable).
 */
export function HomeownerPaymentMethods() {
  const enabled = stripeNewChargeFlowUiEnabled();
  const { cards, loading, error, setDefault, remove, refetch } = useSavedPaymentMethods();

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SavedPaymentMethod | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  if (!enabled) {
    return (
      <div className="py-10">
        <EmptyState
          icon={<CreditCard />}
          title="Payments are not set up"
          description="Saved cards are not available for this company yet."
        />
      </div>
    );
  }

  async function handleSetDefault(pm: SavedPaymentMethod) {
    setBusyId(pm.id);
    try {
      await setDefault(pm.id);
      toast.success('Default card updated');
    } catch (e) {
      toast.error('Could not update your default card', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    // Capture BEFORE removal: was this the default, and what would remain?
    const wasDefault = removeTarget.isDefault;
    const remaining = cards.filter((c) => c.id !== removeTarget.id);
    setRemoving(true);
    try {
      await remove(removeTarget.id);
      setRemoveTarget(null);
      // Never leave the homeowner with no default: if we removed the default and
      // other cards remain, promote the next one (completion charges read the default).
      if (wasDefault && remaining.length > 0) {
        try {
          await setDefault(remaining[0].id);
          toast.success('Card removed', {
            description: `${paymentMethodTitle(remaining[0])} is now your default.`,
          });
        } catch {
          // The removal itself succeeded; only the re-assignment failed.
          toast.success('Card removed');
        }
      } else {
        toast.success('Card removed');
      }
    } catch (e) {
      toast.error('Could not remove this card', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRemoving(false);
    }
  }

  async function handleAdded() {
    await refetch();
    setAddOpen(false);
    toast.success('Card saved');
  }

  return (
    <>
      <HomeownerPaymentMethodsView
        cards={cards}
        loading={loading}
        error={error}
        busyId={busyId}
        onAdd={() => setAddOpen(true)}
        onSetDefault={handleSetDefault}
        onRemove={(pm) => setRemoveTarget(pm)}
        onRetry={() => refetch()}
      />

      <AddCardSheet open={addOpen} onOpenChange={setAddOpen} onSaved={handleAdded} />

      <RemoveCardSheet
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
        label={removeTarget ? paymentMethodTitle(removeTarget) : ''}
        removing={removing}
        onConfirm={handleRemoveConfirm}
      />
    </>
  );
}
