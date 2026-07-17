'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ErrorState } from '@/components/ui/error-state';
import { toast } from '@/components/ui/toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { keys } from '@/lib/queryKeys';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformOrganization } from '@/hooks/usePlatformOrganizations';
import { redesignUiEnabled } from '@/lib/redesign/flags';
import { Field } from '@/components/redesign/bookings/detail-atoms';
import type { PlatformOrgMember } from '@/types/platform';
import { SubscriptionPill, PaymentsPill } from './pills';
import { TenantConnectResetDialog } from './TenantConnectResetDialog';
import { CleanerConnectResetDialog } from './CleanerConnectResetDialog';
import { DeleteTenantDialog } from './DeleteTenantDialog';
import { TenantRecentActivity } from './TenantRecentActivity';

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '-';
  }
}

function memberName(m: PlatformOrgMember): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email || 'Unknown';
}

/**
 * Wide read-only tenant sheet: identity + View as, Billing + Connect (with reset),
 * members (with per-cleaner reset), recent activity, and a danger zone (delete).
 * Mounted once by TenantDetailHost via ?tenant=<id>.
 */
export function TenantDetailSheet({
  tenantId,
  open,
  onClose,
}: {
  tenantId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  // Keep querying by the retained id (not gated on `open`) so the content stays
  // rendered from cache through the sheet's exit animation (no loading flash).
  const { data: org, isLoading, isError, refetch } = usePlatformOrganization(tenantId);
  const { startImpersonation } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [starting, setStarting] = useState(false);
  const [impersonationError, setImpersonationError] = useState<string | null>(null);
  const [resetTenant, setResetTenant] = useState(false);
  const [resetCleaner, setResetCleaner] = useState<{ id: string; name: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function handleViewAs() {
    if (!org) return;
    setImpersonationError(null);
    setStarting(true);
    try {
      const ok = await startImpersonation(org.id, org.name);
      if (!ok) {
        setImpersonationError("Couldn't start View as: the audit log entry failed. Please try again.");
        return;
      }
      router.push(redesignUiEnabled() ? '/app/admin-dashboard' : '/admin-dashboard');
    } finally {
      setStarting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        {isLoading || !tenantId ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : isError || !org ? (
          <div className="grid h-full place-items-center p-6">
            <ErrorState title="Couldn't load this tenant" onRetry={() => refetch()} />
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-y-auto">
            <SheetHeader className="pr-14">
              <SheetTitle>{org.name}</SheetTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <SubscriptionPill status={org.subscription_status} />
                <PaymentsPill org={org} />
              </div>
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => void handleViewAs()} loading={starting}>
                  <Eye /> View as this company
                </Button>
              </div>
              {impersonationError ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {impersonationError}
                </p>
              ) : null}
            </SheetHeader>

            <Separator />

            <div className="space-y-6 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="p-4">
                  <h3 className="mb-3 text-sm font-semibold text-foreground">Billing</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Status">{org.subscription_status}</Field>
                    <Field label="Renews">{fmtDate(org.subscription_current_period_end)}</Field>
                    <Field label="Billing email">{org.billing_email || '-'}</Field>
                    <Field label="Platform fee">{(org.platform_fee_bps / 100).toFixed(2)}%</Field>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Payments (Connect)</h3>
                    <Button variant="outline" size="sm" onClick={() => setResetTenant(true)}>
                      <RotateCcw /> Reset
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Charges">{org.stripe_connect_charges_enabled ? 'Enabled' : 'Off'}</Field>
                    <Field label="Payouts">{org.stripe_connect_payouts_enabled ? 'Enabled' : 'Off'}</Field>
                    <Field label="Details">{org.stripe_connect_details_submitted ? 'Submitted' : 'No'}</Field>
                    <Field label="Payout model">{org.default_payout_model}</Field>
                  </div>
                  {org.stripe_connect_requirements_due.length > 0 ? (
                    <p className="mt-3 rounded-control bg-caution-50 px-3 py-2 text-xs text-caution-700">
                      {org.stripe_connect_requirements_due.length} Stripe requirement(s) outstanding.
                    </p>
                  ) : null}
                </Card>
              </div>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Members</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {org.member_counts.total} total, {org.counts.appointments} appointments
                  </span>
                </div>
                {org.members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members yet.</p>
                ) : (
                  <div className="overflow-hidden rounded-card border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead className="text-right" aria-label="Actions" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {org.members.map((m) => (
                          <TableRow key={m.user_id} className="hover:bg-transparent">
                            <TableCell className="font-medium text-foreground">{memberName(m)}</TableCell>
                            <TableCell className="text-muted-foreground">{m.email || '-'}</TableCell>
                            <TableCell className="capitalize text-muted-foreground">{m.role}</TableCell>
                            <TableCell className="text-right">
                              {m.role === 'cleaner' ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setResetCleaner({ id: m.user_id, name: memberName(m) })
                                  }
                                >
                                  <RotateCcw /> Reset
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>

              <TenantRecentActivity orgId={org.id} />

              <section className="overflow-hidden rounded-card border border-destructive/30">
                <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">Delete this tenant</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Removes the org and all of its data. Org-only users are deleted; multi-org
                      users are detached.
                    </p>
                  </div>
                  <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete organization
                  </Button>
                </div>
              </section>
            </div>

            <TenantConnectResetDialog
              open={resetTenant}
              onOpenChange={setResetTenant}
              orgId={org.id}
              orgName={org.name}
              onDone={() => void refetch()}
            />
            {resetCleaner ? (
              <CleanerConnectResetDialog
                open={!!resetCleaner}
                onOpenChange={(o) => {
                  if (!o) setResetCleaner(null);
                }}
                cleanerId={resetCleaner.id}
                cleanerName={resetCleaner.name}
                onDone={() => void refetch()}
              />
            ) : null}
            <DeleteTenantDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              orgId={org.id}
              orgName={org.name}
              memberCount={org.member_counts.total}
              appointmentCount={org.counts.appointments}
              stripeConnected={Boolean(org.stripe_connect_account_id)}
              onDeleted={() => {
                setDeleteOpen(false);
                toast.success(`Deleted ${org.name}`);
                queryClient.invalidateQueries({ queryKey: keys.platform.organizations.all });
                onClose();
              }}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
