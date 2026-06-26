'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useAdminAppointments, useAdminCustomers, useAdminCleaners } from '@/hooks/useAdminData';
import { useServices } from '@/hooks/useServices';
import { formatDateShort } from '@/lib/formatTime';
import { OPERATOR_NAV } from '@/components/redesign/shell/nav-items';
import {
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import {
  deriveCommandResults,
  type CommandItemVM,
  type PaletteBooking,
  type PaletteCustomer,
  type PaletteCleaner,
  type PaletteService,
} from './deriveCommandResults';

function fullName(first?: string | null, last?: string | null): string {
  return `${first ?? ''} ${last ?? ''}`.trim();
}

/**
 * Permission-gated lazy loaders. Each is rendered only when the viewer may see
 * that entity, so the underlying hook (and its fetch + realtime subscription)
 * never runs for an unauthorized manager. They render nothing; they just lift the
 * mapped, normalized rows up to the palette.
 */
function BookingsLoader({ onData }: { onData: (rows: PaletteBooking[]) => void }) {
  const { appointments } = useAdminAppointments();
  const mapped = useMemo<PaletteBooking[]>(
    () =>
      appointments.map((a) => ({
        id: a.id,
        customerName: fullName(a.homeowner?.first_name, a.homeowner?.last_name),
        cleanerName: fullName(a.cleaner_profile?.user_profile?.first_name, a.cleaner_profile?.user_profile?.last_name),
        property: a.property?.name || a.property?.address || '',
        service: a.service_type?.name || '',
        dateLabel: formatDateShort(a.scheduled_date),
      })),
    [appointments],
  );
  useEffect(() => onData(mapped), [mapped, onData]);
  return null;
}

function CustomersLoader({ onData }: { onData: (rows: PaletteCustomer[]) => void }) {
  const { customers } = useAdminCustomers();
  const mapped = useMemo<PaletteCustomer[]>(
    () =>
      customers.map((c) => ({
        id: c.id,
        name: fullName(c.first_name, c.last_name) || c.email,
        email: c.email,
        phone: c.phone ?? '',
      })),
    [customers],
  );
  useEffect(() => onData(mapped), [mapped, onData]);
  return null;
}

function CleanersLoader({ onData }: { onData: (rows: PaletteCleaner[]) => void }) {
  const { cleaners } = useAdminCleaners();
  const mapped = useMemo<PaletteCleaner[]>(
    () =>
      cleaners.map((c) => ({
        id: c.id,
        name: fullName(c.user_profile?.first_name, c.user_profile?.last_name) || c.user_profile?.email || '',
        email: c.user_profile?.email ?? '',
        roleLabel: 'Cleaner',
      })),
    [cleaners],
  );
  useEffect(() => onData(mapped), [mapped, onData]);
  return null;
}

function ServicesLoader({ onData }: { onData: (rows: PaletteService[]) => void }) {
  const { services } = useServices();
  const mapped = useMemo<PaletteService[]>(
    () =>
      services.map((s) => ({
        id: s.id,
        name: s.name,
        priceLabel: `$${Number(s.base_price ?? 0).toLocaleString('en-US')}`,
      })),
    [services],
  );
  useEffect(() => onData(mapped), [mapped, onData]);
  return null;
}

/**
 * Live results + selection for the command palette. Only mounted while the
 * palette is open (the dialog unmounts its content when closed), so the entity
 * hooks are lazy: they fetch on first open and then serve from the TanStack cache
 * (+ realtime). Pure result derivation lives in deriveCommandResults.
 */
export function CommandPaletteData({
  onClose,
  onNewBooking,
}: {
  onClose: () => void;
  onNewBooking?: () => void;
}) {
  const router = useRouter();
  const { currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();

  const [query, setQuery] = useState('');
  const [bookings, setBookings] = useState<PaletteBooking[]>([]);
  const [customers, setCustomers] = useState<PaletteCustomer[]>([]);
  const [cleaners, setCleaners] = useState<PaletteCleaner[]>([]);
  const [services, setServices] = useState<PaletteService[]>([]);

  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  // Match each redesign screen's own gate so palette search surfaces exactly the
  // content the viewer can reach. Bookings has no gate (every operator can open
  // it); services is viewable with either the view or manage grant.
  const can = useMemo(
    () => ({
      bookings: true,
      customers: privileged || !!permissions?.can_view_customers,
      cleaners: privileged || !!permissions?.can_manage_cleaners,
      services: privileged || !!permissions?.can_view_services || !!permissions?.can_manage_services,
    }),
    [privileged, permissions],
  );

  const groups = useMemo(
    () =>
      deriveCommandResults({
        query,
        bookings,
        customers,
        cleaners,
        services,
        permissions: can,
        nav: OPERATOR_NAV.map((n) => ({ id: n.id, label: n.label, href: n.href, icon: n.icon })),
        actions: onNewBooking
          ? [{ id: 'new-booking', label: 'New booking', keywords: 'create add appointment', icon: Plus }]
          : [],
      }),
    [query, bookings, customers, cleaners, services, can, onNewBooking],
  );

  const onSelect = useCallback(
    (item: CommandItemVM) => {
      if (item.actionId === 'new-booking') {
        onClose();
        onNewBooking?.();
        return;
      }
      if (item.href) {
        onClose();
        router.push(item.href);
      }
    },
    [onClose, onNewBooking, router],
  );

  return (
    <>
      {can.bookings ? <BookingsLoader onData={setBookings} /> : null}
      {can.customers ? <CustomersLoader onData={setCustomers} /> : null}
      {can.cleaners ? <CleanersLoader onData={setCleaners} /> : null}
      {can.services ? <ServicesLoader onData={setServices} /> : null}

      <CommandInput value={query} onValueChange={setQuery} placeholder="Search bookings, customers, cleaners, services..." />
      <CommandList>
        <CommandEmpty>{query ? `No results for "${query}"` : 'Start typing to search.'}</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.group} heading={g.group}>
            {g.items.map((it) => {
              const Icon = it.icon;
              return (
                <CommandItem key={it.key} value={it.key} onSelect={() => onSelect(it)}>
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.sublabel ? (
                    <span className="ml-2 max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                      {it.sublabel}
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
            {g.overflow > 0 ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">
                +{g.overflow} more, refine your search
              </p>
            ) : null}
          </CommandGroup>
        ))}
      </CommandList>
    </>
  );
}
