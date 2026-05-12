'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Loader2,
  Mail,
  Plus,
  AlertCircle,
  RefreshCcw,
  UserCheck,
  Users,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import AddTeamMemberModal from './AddTeamMemberModal';
import InviteStatusBadge from './InviteStatusBadge';
import { getRoleBadgeClasses } from '../lib/roleStyles';
import type { Invite, InviteDisplayStatus } from '../types';

interface InvitesPageProps {
  canResend: boolean;
  invites: Invite[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  resend: (invite: Invite) => Promise<{ success: boolean; error?: string }>;
}

type FilterId = 'all' | InviteDisplayStatus;

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'failed', label: 'Failed' },
  { id: 'expired', label: 'Expired' },
  { id: 'superseded', label: 'Superseded' },
];

const ROLE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  cleaner: UserCheck,
  manager: Users,
  admin: ShieldCheck,
};

function getDisplayStatus(invite: Invite): InviteDisplayStatus {
  if (invite.status === 'pending' && invite.is_expired) return 'expired';
  return invite.status;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffMs = Date.now() - ts;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return future ? 'in moments' : 'just now';
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;
  const months = Math.floor(days / 30);
  return future ? `in ${months}mo` : `${months}mo ago`;
}

function formatExpiry(invite: Invite, displayStatus: InviteDisplayStatus): string {
  const ts = new Date(invite.expiration_date).getTime();
  if (Number.isNaN(ts)) return '';
  const diffMs = ts - Date.now();
  if (displayStatus === 'expired') {
    return diffMs <= 0
      ? `Expired ${formatRelative(invite.expiration_date)}`
      : 'Link no longer valid';
  }
  return diffMs <= 0
    ? `Expired ${formatRelative(invite.expiration_date)}`
    : `Expires ${formatRelative(invite.expiration_date)}`;
}

function getInviterName(invite: Invite): string {
  const p = invite.invited_by_profile;
  if (!p) return 'Unknown';
  const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return name || p.email || 'Unknown';
}

export default function InvitesPage({
  canResend,
  invites,
  loading,
  error,
  refetch,
  resend,
}: InvitesPageProps) {
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterId>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  // Ids of invites the admin has just clicked Resend on. Used to swap the
  // button to a disabled "Sent" state immediately, even before realtime
  // marks the row as superseded.
  const [resentIds, setResentIds] = useState<Set<string>>(new Set());

  // Prune resentIds once a row's status moves out of the resendable range
  // (failed/expired). The "Sent" pill is only meaningful as an immediate
  // replacement for the Resend button; once the row becomes superseded /
  // accepted / pending / creating, the pill should vanish along with the
  // button it was replacing. Using the status (not canResendInvite) keeps
  // the prune independent of mid-session permission changes.
  useEffect(() => {
    setResentIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        const invite = invites.find((inv) => inv.id === id);
        if (
          !invite ||
          (getDisplayStatus(invite) !== 'failed' &&
            getDisplayStatus(invite) !== 'expired')
        ) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [invites]);

  const counts = useMemo(() => {
    const c: Record<FilterId, number> = {
      all: invites.length,
      pending: 0,
      accepted: 0,
      failed: 0,
      expired: 0,
      superseded: 0,
      creating: 0,
    };
    for (const inv of invites) {
      const ds = getDisplayStatus(inv);
      c[ds] = (c[ds] ?? 0) + 1;
    }
    return c;
  }, [invites]);

  const filtered = useMemo(() => {
    let result = invites;
    if (activeFilter !== 'all') {
      result = result.filter((inv) => getDisplayStatus(inv) === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((inv) => inv.email.toLowerCase().includes(q));
    }
    return result;
  }, [invites, activeFilter, searchQuery]);

  const handleResend = async (invite: Invite) => {
    setResendingId(invite.id);
    const result = await resend(invite);
    setResendingId(null);

    if (result.success) {
      setResentIds((prev) => {
        const next = new Set(prev);
        next.add(invite.id);
        return next;
      });
      showToast('Invite resent', {
        description: `New invitation email sent to ${invite.email}`,
        variant: 'email',
      });
    } else {
      showToast('Failed to resend invite', {
        description: result.error || 'Please try again.',
        variant: 'error',
      });
    }
  };

  const canResendInvite = (invite: Invite): boolean => {
    if (!canResend) return false;
    const ds = getDisplayStatus(invite);
    return ds === 'failed' || ds === 'expired';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold text-gray-900">Invites</h2>
          <p className="text-gray-600 mt-1 hidden md:block">
            Track invitations sent to new team members
          </p>
        </div>
        {canResend && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
          >
            <Plus className="w-5 h-5" />
            <span>New</span>
          </button>
        )}
      </div>

      {/* Search Input - mobile only line */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Search + filter chips row */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="hidden md:flex flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const isActive = activeFilter === f.id;
            const count = counts[f.id] ?? 0;
            return (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors duration-200 ${
                  isActive
                    ? 'bg-primary-100 text-primary-700 border-primary-300'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                <span>{f.label}</span>
                <span
                  className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                    isActive ? 'bg-primary-200 text-primary-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading invites...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Couldn&apos;t load invites
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={refetch}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors duration-200"
          >
            <RefreshCcw className="w-4 h-4" />
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Mail className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {invites.length === 0
              ? 'No invites yet'
              : searchQuery || activeFilter !== 'all'
                ? 'No invites match your filters'
                : 'No invites'}
          </h3>
          <p className="text-gray-600">
            {invites.length === 0
              ? 'Send your first invite to get started.'
              : 'Try adjusting your search or filter.'}
          </p>
          {canResend && invites.length === 0 && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Send Invite
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((invite) => {
            const ds = getDisplayStatus(invite);
            const RoleIcon = ROLE_ICON[invite.role] ?? UserCheck;
            const rolePill = getRoleBadgeClasses(invite.role);
            const showResend = canResendInvite(invite);
            const isResending = resendingId === invite.id;
            const justSent = resentIds.has(invite.id);

            const metaParts: React.ReactNode[] = [];
            metaParts.push(
              <span key="inviter">
                <span className="text-gray-500">Invited by</span>{' '}
                <span className="text-gray-900 font-medium">{getInviterName(invite)}</span>
              </span>
            );
            metaParts.push(
              <span key="sent" className="text-gray-500">
                {invite.sent_at ? `Sent ${formatRelative(invite.sent_at)}` : 'Not yet sent'}
              </span>
            );
            if (ds === 'accepted' && invite.accepted_at) {
              metaParts.push(
                <span key="accepted" className="text-gray-500">
                  Accepted {formatRelative(invite.accepted_at)}
                </span>
              );
            }
            if (ds === 'pending' || ds === 'expired') {
              metaParts.push(
                <span key="expiry" className={ds === 'expired' ? 'text-orange-600' : 'text-gray-500'}>
                  {formatExpiry(invite, ds)}
                </span>
              );
            }

            return (
              <div
                key={invite.id}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                  {/* Left: avatar + email + role */}
                  <div className="flex items-center gap-3 min-w-0 md:flex-1">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <Mail className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-base font-semibold text-gray-900 truncate" title={invite.email}>
                          {invite.email}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${rolePill}`}
                        >
                          <RoleIcon className="w-3 h-3" />
                          {invite.role.charAt(0).toUpperCase() + invite.role.slice(1)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {metaParts.map((part, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="text-gray-300">·</span>}
                            {part}
                          </React.Fragment>
                        ))}
                      </p>
                    </div>
                  </div>

                  {/* Right: status + resend */}
                  <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-center">
                    <InviteStatusBadge status={ds} size="sm" />
                    {justSent ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-medium cursor-not-allowed"
                      >
                        <Check className="w-4 h-4" />
                        <span>Sent</span>
                      </button>
                    ) : showResend ? (
                      <button
                        onClick={() => handleResend(invite)}
                        disabled={isResending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-primary-200 text-primary-700 text-sm font-medium hover:bg-primary-50 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isResending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCcw className="w-4 h-4" />
                        )}
                        <span>{isResending ? 'Resending…' : 'Resend'}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add modal — reuses existing send-invite flow */}
      <AddTeamMemberModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onTeamMemberCreated={refetch}
      />
    </div>
  );
}
