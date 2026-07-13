'use client';

import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { stripeSelfPayUiEnabled } from '@/lib/stripe/flags';
import {
  paymentMethodTitle,
  type SavedPaymentMethod,
} from '@/components/redesign/shared/payment-methods/derive-payment-methods';
import { RemoveCardSheet } from '@/components/redesign/shared/payment-methods/RemoveCardSheet';
import { OrgPaymentMethodsView } from './OrgPaymentMethodsView';
import { OrgAddCardSheet } from './OrgAddCardSheet';
import { useOrgPaymentMethods } from './useOrgPaymentMethods';

/**
 * The organization's self-pay company payment methods for Settings > Payments: list, add (Stripe
 * SetupIntent), set-default, remove. A newly added card becomes the charged default (self-pay
 * completion charges read the Customer's default). Behind `stripeSelfPayUiEnabled()`; the parent
 * section also gates on the same flag, so this returns null defensively when off.
 */
export function OrgPaymentMethods() {
  const { currentOrganizationId } = useAuth();
  const enabled = stripeSelfPayUiEnabled();
  const { cards, loading, error, setDefault, remove, refetch } = useOrgPaymentMethods();

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SavedPaymentMethod | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  if (!enabled) return null;

  async function handleSetDefault(pm: SavedPaymentMethod) {
    setBusyId(pm.id);
    try {
      await setDefault(pm.id);
      toast.success('Default company card updated');
    } catch (e) {
      toast.error('Could not update the default card', {
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
      // Never leave the org with no charged default: if we removed the default and other cards
      // remain, promote the next one (self-pay completion charges read the default).
      if (wasDefault && remaining.length > 0) {
        try {
          await setDefault(remaining[0].id);
          toast.success('Card removed', {
            description: `${paymentMethodTitle(remaining[0])} is now the default.`,
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

  async function handleAdded(pmId: string) {
    // A newly added company card becomes the charged default (you added it to use it).
    try {
      await setDefault(pmId);
    } catch {
      // Best-effort: the card is still saved and listed even if set-default failed.
    }
    await refetch();
    setAddOpen(false);
    toast.success('Company card saved');
  }

  return (
    <>
      <OrgPaymentMethodsView
        cards={cards}
        loading={loading}
        error={error}
        busyId={busyId}
        onAdd={() => setAddOpen(true)}
        onSetDefault={handleSetDefault}
        onRemove={(pm) => setRemoveTarget(pm)}
        onRetry={() => refetch()}
      />

      {currentOrganizationId ? (
        <OrgAddCardSheet
          open={addOpen}
          onOpenChange={setAddOpen}
          organizationId={currentOrganizationId}
          onSaved={handleAdded}
        />
      ) : null}

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
