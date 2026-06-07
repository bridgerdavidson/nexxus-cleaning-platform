'use client';

import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, ChevronDown, Check, UserPlus } from 'lucide-react';
import { useNotifications, type NotificationItem } from '../hooks/useNotifications';
import { describeNotification, type NotificationTone } from '../lib/notifications/labels';
import { formatTimeTo12h } from '../lib/formatTime';

// Icon tint per tone, matching the ToastContext palette (success/red/amber/blue).
const TONE_CLASSES: Record<NotificationTone, string> = {
  success: 'text-success-600 bg-success-100',
  error: 'text-red-600 bg-red-100',
  warning: 'text-amber-600 bg-amber-100',
  info: 'text-blue-600 bg-blue-100',
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const s = Math.floor(diffMs / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function payloadString(n: NotificationItem, key: string): string | undefined {
  const v = n.payload?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** A run of notifications that share an appointment, newest first. */
interface NotificationGroup {
  key: string;
  items: NotificationItem[];
  latest: NotificationItem;
  unreadIds: string[];
}

function groupByAppointment(items: NotificationItem[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const byAppointment = new Map<string, NotificationGroup>();
  for (const n of items) {
    const unread = n.in_app_dispatched_at ? [] : [n.id];
    if (n.appointment_id) {
      const existing = byAppointment.get(n.appointment_id);
      if (existing) {
        existing.items.push(n);
        existing.unreadIds.push(...unread);
        continue;
      }
      const group: NotificationGroup = {
        key: n.appointment_id,
        items: [n],
        latest: n,
        unreadIds: [...unread],
      };
      byAppointment.set(n.appointment_id, group);
      groups.push(group);
    } else {
      groups.push({ key: `solo:${n.id}`, items: [n], latest: n, unreadIds: [...unread] });
    }
  }
  return groups;
}

/** Intent a click carries up: open the appointment, optionally pre-opening assignment. */
export type NotificationOpenIntent = 'assign' | undefined;

interface NotificationBellProps {
  /** Called when a notification tied to an appointment is opened. */
  onOpenNotification?: (notification: NotificationItem, intent?: NotificationOpenIntent) => void;
  /** 'dropdown' (desktop top bar) renders a right-anchored panel; 'sheet'
   *  (mobile) opens a full-width bottom sheet. */
  variant?: "dropdown" | "sheet";
  /** Notifies the parent when the panel opens/closes. The mobile top bar uses
   *  this to hide its white bar while the sheet is up, so the iOS safe-area tint
   *  matches the backdrop instead of staying white. */
  onOpenChange?: (open: boolean) => void;
}

function ToneIcon({ tone, icon: Icon }: { tone: NotificationTone; icon: typeof Bell }) {
  return (
    <span
      className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg ${TONE_CLASSES[tone]}`}
    >
      <Icon className="w-4 h-4" />
    </span>
  );
}

/**
 * Top-bar notification bell + dropdown center. Backed by useNotifications (live
 * via realtime). Two-line items, a brand-gold unread badge, grouping of repeated
 * updates for the same appointment, and inline actions (accept a counter-proposed
 * time, jump to cleaner assignment). Outside-click / Escape close. Mounted in
 * TopBar so all four dashboards inherit it.
 */
export default function NotificationBell({ onOpenNotification, variant = "dropdown", onOpenChange }: NotificationBellProps) {
  const {
    notifications,
    unreadCount,
    loading,
    markAllRead,
    markOneRead,
    markManyRead,
    acceptCounterProposal,
    acceptCounterPending,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Swipe-down-to-close for the mobile sheet (drag the grab handle).
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const dragYRef = useRef(0);
  const dragStartY = useRef<number | null>(null);

  // Tell the mobile top bar when the sheet is open so it can hide its white bar
  // (keeps the iOS safe-area tint matching the backdrop instead of white). Held
  // in a ref so an inline parent callback doesn't re-run the effect every render.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    onOpenChangeRef.current?.(open);
    if (!open) {
      setDragY(0);
      setClosing(false);
    }
  }, [open]);

  // Close the sheet with a slide-down animation instead of an instant unmount:
  // drive the panel off-screen via the existing transform transition, then
  // unmount once it has settled. The dropdown variant closes immediately.
  const closeSheet = () => {
    if (variant !== "sheet") {
      setOpen(false);
      return;
    }
    if (closing) return;
    setClosing(true);
    setDragY(typeof window !== "undefined" ? window.innerHeight : 800);
    window.setTimeout(() => setOpen(false), 240);
  };

  const handleSheetTouchStart = (e: ReactTouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  };
  const handleSheetTouchMove = (e: ReactTouchEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    const v = dy > 0 ? dy : 0;
    dragYRef.current = v;
    setDragY(v);
  };
  const handleSheetTouchEnd = () => {
    const shouldClose = dragYRef.current > 90;
    dragStartY.current = null;
    dragYRef.current = 0;
    if (shouldClose) closeSheet();
    else setDragY(0);
  };

  const groups = useMemo(() => groupByAppointment(notifications), [notifications]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // The sheet is portaled to document.body (outside ref.current), so a
    // document-level outside-click would fire for taps INSIDE the sheet and
    // close it on mousedown before the item's click lands. The sheet uses its
    // own backdrop for outside-click; only the dropdown needs this listener.
    if (variant === 'dropdown') document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, variant]);

  const openNotification = (n: NotificationItem, unreadIds: string[], intent?: NotificationOpenIntent) => {
    if (unreadIds.length > 0) markManyRead(unreadIds);
    if (n.appointment_id && onOpenNotification) onOpenNotification(n, intent);
    closeSheet();
  };

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAccept = async (n: NotificationItem) => {
    const suggestedTimeId = payloadString(n, 'suggested_time_id');
    if (!suggestedTimeId || !n.appointment_id) return;
    setAcceptingId(n.id);
    await acceptCounterProposal({
      appointmentId: n.appointment_id,
      organizationId: n.organization_id,
      suggestedTimeId,
    });
    setAcceptingId(null);
    if (!n.in_app_dispatched_at) markOneRead(n.id);
    closeSheet();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-gray-600 hover:text-primary-600 hover:bg-gray-50 transition-colors"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell className={`w-5 h-5 ${open ? 'text-primary-600' : ''}`} />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-500 text-gray-900 text-[10px] font-bold leading-none flex items-center justify-center border-2 border-white tabular-nums"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open &&
        (() => {
          const panel = (
            <>
              {variant === "sheet" && (
                <div
                  className="fixed inset-0 z-40 bg-black/40 animate-fade-in transition-opacity duration-200"
                  style={{ opacity: closing ? 0 : undefined }}
                  onClick={closeSheet}
                  aria-hidden
                />
              )}
          <div
            role="menu"
            aria-label="Notifications"
            className={
              variant === "sheet"
                ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl animate-sheet-up pb-[env(safe-area-inset-bottom)]"
                : "absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden animate-fade-in"
            }
            style={
              variant === "sheet"
                ? {
                    transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
                    transition:
                      dragStartY.current !== null
                        ? "none"
                        : "transform 240ms cubic-bezier(0.32, 0.72, 0, 1)",
                  }
                : undefined
            }
          >
            {variant === "sheet" && (
              <div
                className="flex shrink-0 justify-center pt-3 pb-2 touch-none cursor-grab active:cursor-grabbing"
                onTouchStart={handleSheetTouchStart}
                onTouchMove={handleSheetTouchMove}
                onTouchEnd={handleSheetTouchEnd}
              >
                <span className="h-1 w-10 rounded-full bg-gray-300" />
              </div>
            )}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto overscroll-contain">
            {loading && notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-400">Loading...</div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex items-center justify-center w-11 h-11 rounded-full bg-gray-100 mb-3">
                  <Bell className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-900">You are all caught up</p>
                <p className="mt-0.5 text-xs text-gray-500">New updates will show up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {groups.map((group) => {
                  const n = group.latest;
                  const d = describeNotification(n.event_type, n.payload);
                  const groupUnread = group.unreadIds.length > 0;
                  const hasMore = group.items.length > 1;
                  const isExpanded = expanded.has(group.key);
                  const canAccept =
                    n.event_type === 'cleaner_counter_proposed' && !!payloadString(n, 'suggested_time_id');
                  const canAssign = n.event_type === 'chain_exhausted';
                  const acceptTime = payloadString(n, 'suggested_time');

                  return (
                    <li key={group.key} className={groupUnread ? 'bg-primary-50' : ''}>
                      <div className="flex items-start gap-3 px-4 py-3">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openNotification(n, group.unreadIds)}
                          className="flex items-start gap-3 flex-1 min-w-0 text-left"
                        >
                          <ToneIcon tone={d.tone} icon={d.icon} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-gray-900 leading-snug">
                              {d.title}
                            </span>
                            {d.detail && (
                              <span className="block mt-0.5 text-xs text-gray-500 leading-snug">
                                {d.detail}
                              </span>
                            )}
                            <span className="block mt-1 text-xs text-gray-400">
                              {relativeTime(n.created_at)}
                              {hasMore && (
                                <span className="text-gray-400"> &middot; {group.items.length} updates</span>
                              )}
                            </span>
                          </span>
                        </button>
                        <span className="flex flex-col items-center gap-1.5 pt-0.5">
                          {groupUnread && (
                            <span aria-hidden className="w-2 h-2 rounded-full bg-primary-500" />
                          )}
                          {hasMore && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(group.key)}
                              aria-label={isExpanded ? 'Collapse updates' : 'Expand updates'}
                              aria-expanded={isExpanded}
                              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            >
                              <ChevronDown
                                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                          )}
                        </span>
                      </div>

                      {(canAccept || canAssign) && (
                        <div className="flex flex-wrap gap-2 px-4 pb-3 pl-16">
                          {canAccept && (
                            <button
                              type="button"
                              onClick={() => handleAccept(n)}
                              disabled={acceptCounterPending && acceptingId === n.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 transition-colors disabled:opacity-60"
                            >
                              <Check className="w-3.5 h-3.5" />
                              {acceptingId === n.id
                                ? 'Confirming...'
                                : acceptTime
                                  ? `Accept ${formatTimeTo12h(acceptTime)}`
                                  : 'Accept this time'}
                            </button>
                          )}
                          {canAssign && (
                            <button
                              type="button"
                              onClick={() => openNotification(n, group.unreadIds, 'assign')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              Assign cleaner
                            </button>
                          )}
                        </div>
                      )}

                      {hasMore && isExpanded && (
                        <ul className="border-t border-gray-100 bg-gray-50/60">
                          {group.items.slice(1).map((sub) => {
                            const sd = describeNotification(sub.event_type, sub.payload);
                            const subUnread = !sub.in_app_dispatched_at;
                            return (
                              <li key={sub.id}>
                                <button
                                  type="button"
                                  onClick={() => openNotification(sub, subUnread ? [sub.id] : [])}
                                  className="w-full flex items-start gap-2.5 px-4 py-2.5 pl-16 text-left hover:bg-gray-100/70 transition-colors"
                                >
                                  <span
                                    aria-hidden
                                    className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                      subUnread ? 'bg-primary-500' : 'bg-gray-300'
                                    }`}
                                  />
                                  <span className="flex-1 min-w-0">
                                    <span className="block text-xs font-medium text-gray-800 leading-snug">
                                      {sd.title}
                                    </span>
                                    <span className="block mt-0.5 text-[11px] text-gray-400">
                                      {relativeTime(sub.created_at)}
                                    </span>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
            </div>
            </>
          );
          return variant === "sheet" && typeof document !== "undefined"
            ? createPortal(panel, document.body)
            : panel;
        })()}
    </div>
  );
}
