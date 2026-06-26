'use client';

import { useEffect } from 'react';
import { CommandDialog } from '@/components/ui/command';
import { CommandPaletteData } from './CommandPaletteData';

/**
 * The operator command palette. Always mounted in the shell so its global
 * Cmd+K / Ctrl+K shortcut works from anywhere; the heavy data component only
 * mounts while open (the dialog unmounts its content when closed), keeping the
 * entity hooks lazy. Open state is owned by the shell so the top bar search
 * trigger can open it too.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onNewBooking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewBooking?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {open ? <CommandPaletteData onClose={() => onOpenChange(false)} onNewBooking={onNewBooking} /> : null}
    </CommandDialog>
  );
}
