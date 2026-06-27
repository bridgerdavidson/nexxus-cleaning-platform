'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { useNotifications } from '@/hooks/useNotifications';
import { useIsMobile } from '@/hooks/useIsMobile';
import { deriveNotificationGroups, type NotificationItemVM } from './deriveNotifications';
import { NotificationPanel } from './NotificationPanel';
import type { NotificationRole } from '@/lib/notifications/navigation';

/**
 * Redesign operator notification bell. Reuses the headless `useNotifications`
 * hook (feed + realtime + mark-read + accept-counter) and renders a native
 * redesign panel: a Popover on desktop, a vaul Drawer (bottom sheet) on mobile.
 * Lives in the operator top bar.
 */
export function NotificationBell({ role = 'admin' }: { role?: NotificationRole } = {}) {
  const {
    notifications,
    unreadCount,
    loading,
    markAllRead,
    markOneRead,
    markManyRead,
    acceptCounterProposal,
  } = useNotifications();
  const router = useRouter();
  const isMobile = useIsMobile();

  const [open, setOpen] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  // Drives the relative-time labels; refreshed each time the panel opens so
  // "just now"/"5m ago" don't go stale during a long-lived session.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (open) setNow(Date.now());
  }, [open]);

  const groups = useMemo(
    () => deriveNotificationGroups(notifications, now, role),
    [notifications, now, role],
  );

  const handleOpen = useCallback(
    (item: NotificationItemVM, unreadIds: string[]) => {
      if (unreadIds.length > 0) markManyRead(unreadIds);
      setOpen(false);
      router.push(item.href);
    },
    [markManyRead, router],
  );

  const handleAccept = useCallback(
    async (item: NotificationItemVM) => {
      if (item.action?.kind !== 'accept' || !item.action.suggestedTimeId || !item.appointmentId) {
        return;
      }
      setAcceptingId(item.id);
      const result = await acceptCounterProposal({
        appointmentId: item.appointmentId,
        organizationId: item.organizationId,
        suggestedTimeId: item.action.suggestedTimeId,
      });
      setAcceptingId(null);
      // Only clear + close on confirmed success; on failure the hook already
      // surfaced an error toast and the row stays unread so the user can retry.
      if (result) {
        if (item.unread) markOneRead(item.id);
        setOpen(false);
      }
    },
    [acceptCounterProposal, markOneRead],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
    >
      <Bell className="h-5 w-5" aria-hidden />
      {unreadCount > 0 ? (
        <span
          aria-hidden
          className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-brand-600 px-1 text-[10px] font-bold leading-none tabular-nums text-white"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </Button>
  );

  const panel = (
    <NotificationPanel
      groups={groups}
      loading={loading}
      unreadCount={unreadCount}
      expandedKeys={expandedKeys}
      acceptingId={acceptingId}
      onOpen={handleOpen}
      onAccept={handleAccept}
      onToggleExpand={toggleExpand}
      onMarkAllRead={markAllRead}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerTitle className="sr-only">Notifications</DrawerTitle>
          {panel}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-label="Notifications"
        className="flex max-h-[min(32rem,70vh)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
