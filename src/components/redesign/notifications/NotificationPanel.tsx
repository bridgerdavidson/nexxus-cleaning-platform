'use client';

import { Bell, Check, CheckCheck, ChevronDown, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import type { NotificationTone } from '@/lib/notifications/labels';
import type { NotificationGroupVM, NotificationItemVM } from './deriveNotifications';

/** Icon chip tint per tone, using the redesign status ramps (50 bg / 700 fg). */
const TONE_CHIP: Record<NotificationTone, string> = {
  success: 'bg-positive-50 text-positive-700',
  error: 'bg-critical-50 text-critical-700',
  warning: 'bg-caution-50 text-caution-700',
  info: 'bg-info-50 text-info-700',
};

export interface NotificationPanelProps {
  groups: NotificationGroupVM[];
  loading: boolean;
  unreadCount: number;
  expandedKeys: Set<string>;
  acceptingId: string | null;
  /** Open a row: navigate to its href and mark the given unread ids read. */
  onOpen: (item: NotificationItemVM, unreadIds: string[]) => void;
  onAccept: (item: NotificationItemVM) => void;
  onToggleExpand: (key: string) => void;
  onMarkAllRead: () => void;
}

function ToneIcon({ item }: { item: NotificationItemVM }) {
  const Icon = item.descriptor.icon;
  return (
    <span
      className={cn(
        'flex h-9 w-9 flex-none items-center justify-center rounded-control',
        TONE_CHIP[item.descriptor.tone],
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

export function NotificationPanel({
  groups,
  loading,
  unreadCount,
  expandedKeys,
  acceptingId,
  onOpen,
  onAccept,
  onToggleExpand,
  onMarkAllRead,
}: NotificationPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-bold text-foreground">Notifications</h2>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="inline-flex items-center gap-1 rounded-control text-xs font-semibold text-brand-ink outline-none hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            Mark all read
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && groups.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading...</p>
        ) : groups.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Bell aria-hidden />}
              title="You're all caught up"
              description="New updates will show up here."
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((group) => {
              const n = group.latest;
              const expanded = expandedKeys.has(group.key);
              return (
                <li key={group.key} className={group.anyUnread ? 'bg-brand-50' : undefined}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(n, group.unreadIds)}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ToneIcon item={n} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-snug text-foreground">
                          {n.descriptor.title}
                        </span>
                        {n.descriptor.detail ? (
                          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                            {n.descriptor.detail}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-xs text-muted-foreground/80">
                          {n.relative}
                          {group.moreCount > 0 ? ` · ${group.items.length} updates` : ''}
                        </span>
                      </span>
                    </button>
                    <span className="flex flex-col items-center gap-1.5 pt-0.5">
                      {group.anyUnread ? (
                        <span aria-hidden className="h-2 w-2 rounded-full bg-brand-600" />
                      ) : null}
                      {group.moreCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => onToggleExpand(group.key)}
                          aria-label={expanded ? 'Collapse updates' : 'Expand updates'}
                          aria-expanded={expanded}
                          className="rounded-control p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronDown
                            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')}
                            aria-hidden
                          />
                        </button>
                      ) : null}
                    </span>
                  </div>

                  {n.action ? (
                    <div className="flex flex-wrap gap-2 px-4 pb-3 pl-[4.25rem]">
                      {n.action.kind === 'accept' ? (
                        <button
                          type="button"
                          onClick={() => onAccept(n)}
                          disabled={acceptingId === n.id}
                          className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white outline-none hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          {acceptingId === n.id ? 'Confirming...' : n.action.label}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpen(n, group.unreadIds)}
                          className="inline-flex items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-xs font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <UserPlus className="h-3.5 w-3.5" aria-hidden />
                          {n.action.label}
                        </button>
                      )}
                    </div>
                  ) : null}

                  {group.moreCount > 0 && expanded ? (
                    <ul className="border-t border-border bg-muted/40">
                      {group.items.slice(1).map((sub) => (
                        <li key={sub.id}>
                          <button
                            type="button"
                            onClick={() => onOpen(sub, sub.unread ? [sub.id] : [])}
                            className="flex w-full items-start gap-2.5 px-4 py-2.5 pl-[4.25rem] text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span
                              aria-hidden
                              className={cn(
                                'mt-1.5 h-1.5 w-1.5 flex-none rounded-full',
                                sub.unread ? 'bg-brand-600' : 'bg-muted-foreground/40',
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-medium leading-snug text-foreground">
                                {sub.descriptor.title}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
                                {sub.relative}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
