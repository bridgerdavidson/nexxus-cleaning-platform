import React from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCcw,
  Loader2,
} from 'lucide-react';
import type { InviteDisplayStatus } from '../types';

interface InviteStatusBadgeProps {
  status: InviteDisplayStatus;
  size?: 'sm' | 'md' | 'lg';
}

const CONFIG: Record<
  InviteDisplayStatus,
  { bg: string; text: string; icon: React.ComponentType<{ className?: string }>; label: string; spin?: boolean }
> = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock, label: 'Pending' },
  accepted: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle2, label: 'Accepted' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle, label: 'Failed' },
  expired: { bg: 'bg-orange-100', text: 'text-orange-700', icon: AlertCircle, label: 'Expired' },
  superseded: { bg: 'bg-gray-100', text: 'text-gray-600', icon: RefreshCcw, label: 'Superseded' },
  creating: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Loader2, label: 'Sending…', spin: true },
};

export default function InviteStatusBadge({ status, size = 'md' }: InviteStatusBadgeProps) {
  const config = CONFIG[status] ?? CONFIG.pending;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${config.bg} ${config.text} ${sizeClasses[size]}`}
    >
      <Icon className={`${iconSizes[size]} ${config.spin ? 'animate-spin' : ''}`} />
      {config.label}
    </span>
  );
}
