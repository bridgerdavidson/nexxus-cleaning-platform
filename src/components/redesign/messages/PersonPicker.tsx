'use client';

import { Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/useIsMobile';

/**
 * The one compose picker shell (D11): Dialog on desktop, bottom-sheet Drawer on
 * phones, with an optional search field. Consumers render PersonPickerRow (or
 * their own static options) as children.
 */
export function PersonPicker({
  open,
  onOpenChange,
  title,
  search,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Omit for short fixed lists (no search field). */
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile('(max-width: 1023px)');

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          {search && (
            <div className="relative px-4 pb-1">
              <Search
                className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder}
                className="h-11 pl-9"
                aria-label={search.placeholder}
              />
            </div>
          )}
          <div className="max-h-[60dvh] overflow-y-auto px-2 pb-[max(env(safe-area-inset-bottom),1rem)] pt-1">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {search && (
          <div className="relative px-5 pt-2">
            <Search
              className="pointer-events-none absolute left-8 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              className="h-10 pl-9"
              aria-label={search.placeholder}
            />
          </div>
        )}
        <div className="max-h-[50vh] min-h-0 overflow-y-auto p-2">{children}</div>
        <div className="h-3" />
      </DialogContent>
    </Dialog>
  );
}

/** A pickable person (or static option, via `icon`) inside a PersonPicker. */
export function PersonPickerRow({
  avatarUrl,
  initials,
  icon,
  title,
  subtitle,
  onSelect,
}: {
  avatarUrl?: string | null;
  initials?: string;
  /** Icon tile instead of an avatar (e.g. the "Cleaning office" option). */
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-control px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent hover:bg-accent/60"
    >
      {icon ? (
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-pill bg-primary/10 text-primary"
        >
          {icon}
        </span>
      ) : (
        <Avatar className="size-10 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials ?? '?'}</AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
    </button>
  );
}
