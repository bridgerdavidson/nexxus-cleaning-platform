'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { countPropertyAppointments, archiveOrDeleteProperty } from '@/hooks/useAdminData';
import { planPropertyDeletion, type PropertyDeletePlan } from '@/lib/properties/deletePlan';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

export interface DeletePropertySheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  propertyName: string;
  onDeleted: () => void;
}

/**
 * Homeowner-side property delete. Routes through the same safe executor as the
 * operator (`archiveOrDeleteProperty`) so history is never destroyed: a
 * never-booked property is hard-deleted, a property with only past cleanings is
 * archived (hidden but its records still resolve). A property that still has
 * UPCOMING cleanings is blocked: a homeowner cannot self-cancel scheduled jobs,
 * so we tell them to contact the company. (Product decision, 2026-07-13.)
 */
export function DeletePropertySheet({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  onDeleted,
}: DeletePropertySheetProps) {
  const { user, currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<PropertyDeletePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Re-check the property's cleanings every time the sheet opens (a cleaning
  // could have been booked/cancelled since last time). Reset on close.
  useEffect(() => {
    if (!open) {
      setPlan(null);
      setError(null);
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const counts = await countPropertyAppointments(propertyId);
        if (stale) return;
        setPlan(planPropertyDeletion(counts));
      } catch (e) {
        if (stale) return;
        setError(e instanceof Error ? e.message : "Could not check this property's cleanings.");
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, propertyId]);

  // A property with upcoming cleanings can't be self-deleted by a homeowner.
  const blockedByUpcoming = plan?.action === 'cancel-and-archive';

  async function onConfirm() {
    if (!currentOrganizationId) return;
    setDeleting(true);
    const res = await archiveOrDeleteProperty(propertyId, currentOrganizationId);
    setDeleting(false);
    if (!res.success) {
      toast.error('Could not delete the property', { description: res.error });
      return;
    }
    if (user?.id) {
      await queryClient.invalidateQueries({ queryKey: keys.properties.byHomeowner(user.id) });
    }
    toast.success('Property deleted');
    onOpenChange(false);
    onDeleted();
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !deleting && onOpenChange(v)}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Delete &quot;{propertyName}&quot;?</DrawerTitle>
          <DrawerDescription>
            {loading
              ? 'Checking cleanings for this property...'
              : blockedByUpcoming
                ? `You have ${plan?.liveCount} upcoming cleaning${plan?.liveCount === 1 ? '' : 's'} scheduled at this property. Contact your cleaning company to cancel them before removing it.`
                : plan?.action === 'archive-only'
                  ? 'Your past cleanings stay on record. This property will be removed from your account.'
                  : 'This property has no cleanings on record and will be permanently removed. This cannot be undone.'}
          </DrawerDescription>
        </DrawerHeader>

        {error ? (
          <div className="mx-4 flex items-start gap-2 rounded-control border border-critical/30 bg-critical-50 px-3 py-2 text-sm text-critical-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <DrawerFooter>
          {blockedByUpcoming ? (
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Got it
            </Button>
          ) : (
            <>
              <Button
                onClick={onConfirm}
                loading={deleting}
                disabled={loading || deleting || !!error}
                className="w-full bg-critical text-white hover:bg-critical/90"
              >
                Delete property
              </Button>
              <Button variant="ghost" className="w-full" disabled={deleting} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
