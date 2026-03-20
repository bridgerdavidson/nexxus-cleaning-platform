'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail, X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export type ToastVariant = 'email' | 'success' | 'error' | 'info';

export interface ToastOptions {
  description?: string;
  duration?: number;
  variant?: ToastVariant;
}

interface ToastItem {
  id: string;
  message: string;
  description?: string;
  duration: number;
  variant: ToastVariant;
  exiting: boolean;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

const VARIANT_ICON: Record<ToastVariant, React.ReactNode> = {
  email:   <Mail className="w-5 h-5 text-primary-600" />,
  success: <CheckCircle className="w-5 h-5 text-success-600" />,
  error:   <AlertCircle className="w-5 h-5 text-red-600" />,
  info:    <Info className="w-5 h-5 text-blue-600" />,
};

const VARIANT_ICON_BG: Record<ToastVariant, string> = {
  email:   'bg-primary-100',
  success: 'bg-success-100',
  error:   'bg-red-100',
  info:    'bg-blue-100',
};

const VARIANT_BAR: Record<ToastVariant, string> = {
  email:   'bg-primary-600',
  success: 'bg-success-600',
  error:   'bg-red-500',
  info:    'bg-blue-500',
};

// Individual toast card
function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  return (
    <div
      className={`
        relative w-80 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden
        ${toast.exiting ? 'animate-toast-out' : 'animate-toast-in'}
      `}
      role="alert"
      aria-live="polite"
    >
      {/* Content */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        {/* Icon */}
        <div className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg ${VARIANT_ICON_BG[toast.variant]}`}>
          {VARIANT_ICON[toast.variant]}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-semibold text-gray-900 leading-snug">{toast.message}</p>
          {toast.description && (
            <p className="mt-0.5 text-xs text-gray-500 leading-snug truncate">{toast.description}</p>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar — drains left-to-right over `duration` ms */}
      <div className="h-1 w-full bg-gray-100">
        <div
          className={`h-full ${VARIANT_BAR[toast.variant]} origin-left`}
          style={{
            animation: `toast-progress ${toast.duration}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
}

// Toast container rendered via portal — only after mount to avoid SSR/hydration mismatch
function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed bottom-6 right-6 z-[60] flex flex-col-reverse gap-2 items-end pointer-events-none"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

// Provider
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    // Mark as exiting to play the out-animation, then remove
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 260);
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    removeToast(id);
  }, [removeToast]);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duration = options?.duration ?? 5000;
    const variant = options?.variant ?? 'email';

    const item: ToastItem = {
      id,
      message,
      description: options?.description,
      duration,
      variant,
      exiting: false,
    };

    setToasts((prev) => [item, ...prev]);

    const timer = setTimeout(() => removeToast(id), duration);
    timers.current.set(id, timer);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
