'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { keys } from '@/lib/queryKeys';
import { deleteProperty } from '@/hooks/useAdminData';
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

export function DeletePropertySheet({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  onDeleted,
}: DeletePropertySheetProps) {
  const { user, currentOrganizationId } = useAuth();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  async function onConfirm() {
    if (!currentOrganizationId) return;
    setDeleting(true);
    const res = await deleteProperty(propertyId, currentOrganizationId);
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
          <DrawerTitle>Delete property?</DrawerTitle>
          <DrawerDescription>
            Delete &quot;{propertyName}&quot;? This cannot be undone.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button
            onClick={onConfirm}
            loading={deleting}
            className="w-full bg-critical text-white hover:bg-critical/90"
          >
            Delete property
          </Button>
          <Button variant="ghost" className="w-full" disabled={deleting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
