'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useNotifications, type NotificationItem } from '../hooks/useNotifications';
import { describeNotification, type NotificationTone } from '../lib/notifications/labels';

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

interface NotificationBellProps {
  /** Called with the appointment id when a notification tied to one is clicked. */
  onOpenAppointment?: (appointmentId: string) => void;
}

/**
 * Top-bar notification bell + dropdown center. Backed by useNotifications (live
 * via realtime). Shows an unread count badge, a list with per-type icon + label
 * + relative time, "Mark all read", and an empty state. Outside-click / Escape
 * close. Mounted in TopBar so all four dashboards inherit it.
 */
export default function NotificationBell({ onOpenAppointment }: NotificationBellProps) {
  const { notifications, unreadCount, loading, markAllRead, markOneRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleItemClick = (n: NotificationItem) => {
    if (!n.in_app_dispatched_at) markOneRead(n.id);
    if (n.appointment_id && onOpenAppointment) onOpenAppointment(n.appointment_id);
    setOpen(false);
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
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none flex items-center justify-center border-2 border-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden animate-fade-in"
        >
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
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <div className="flex items-center justify-center w-11 h-11 rounded-full bg-gray-100 mb-3">
                  <Bell className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-900">You are all caught up</p>
                <p className="mt-0.5 text-xs text-gray-500">New updates will show up here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {notifications.map((n) => {
                  const descriptor = describeNotification(n.event_type);
                  const Icon = descriptor.icon;
                  const unread = !n.in_app_dispatched_at;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => handleItemClick(n)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                          unread ? 'bg-primary-50' : ''
                        }`}
                      >
                        <span
                          className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg ${
                            TONE_CLASSES[descriptor.tone]
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900 leading-snug">
                            {descriptor.label}
                          </span>
                          <span className="block mt-0.5 text-xs text-gray-500">
                            {relativeTime(n.created_at)}
                          </span>
                        </span>
                        {unread && (
                          <span
                            aria-hidden
                            className="flex-shrink-0 mt-1.5 w-2 h-2 rounded-full bg-primary-500"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
