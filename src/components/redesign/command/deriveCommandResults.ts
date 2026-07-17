/**
 * Pure result derivation for the operator command palette.
 *
 * Given the current query, the (already permission-filtered upstream, but
 * re-checked here) entity arrays, and the nav/action lists, produce ordered
 * groups of view-models. Entity matching is a simple case-insensitive substring
 * over a per-entity haystack (mirrors the in-page list search). No React, no
 * data layer, so it is unit-testable in isolation; the data component maps the
 * concrete hook rows into the normalized Palette* shapes below.
 */
import { ClipboardList, BookUser, Users, Tag, type LucideIcon } from 'lucide-react';

export type CommandGroupName = 'Bookings' | 'Customers' | 'Cleaners' | 'Services' | 'Actions';

export interface PaletteBooking {
  id: string;
  customerName: string;
  cleanerName: string;
  property: string;
  service: string;
  dateLabel: string;
}
export interface PaletteCustomer {
  id: string;
  name: string;
  email: string;
  phone: string;
}
export interface PaletteCleaner {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
}
export interface PaletteService {
  id: string;
  name: string;
  priceLabel: string;
}

export interface CommandNavDef {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}
export interface CommandActionDef {
  id: string;
  label: string;
  /** Extra match terms (e.g. "create add") so an action surfaces on synonyms. */
  keywords?: string;
  icon: LucideIcon;
}

export interface CommandPermissions {
  bookings: boolean;
  customers: boolean;
  cleaners: boolean;
  services: boolean;
}

export interface CommandItemVM {
  /** Stable, unique within the palette (e.g. "booking:123", "nav:payments"). */
  key: string;
  label: string;
  sublabel?: string;
  icon: LucideIcon;
  group: CommandGroupName;
  /** Navigation target for entity + nav items. */
  href?: string;
  /** Action id for non-navigation actions (e.g. "new-booking"). */
  actionId?: string;
}

export interface CommandGroupVM {
  group: CommandGroupName;
  items: CommandItemVM[];
  /** How many additional matches were trimmed by the per-group cap. */
  overflow: number;
}

export interface DeriveCommandInput {
  query: string;
  bookings: PaletteBooking[];
  customers: PaletteCustomer[];
  cleaners: PaletteCleaner[];
  services: PaletteService[];
  permissions: CommandPermissions;
  nav: CommandNavDef[];
  actions: CommandActionDef[];
  /** Max entity results shown per group before overflow. */
  cap?: number;
}

const DEFAULT_CAP = 5;

function matches(haystack: string, q: string): boolean {
  return haystack.toLowerCase().includes(q);
}

function joinDot(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => !!p && p.trim().length > 0);
  return kept.length ? kept.join(' · ') : undefined;
}

export function deriveCommandResults(input: DeriveCommandInput): CommandGroupVM[] {
  const { bookings, customers, cleaners, services, permissions, nav, actions } = input;
  const cap = input.cap ?? DEFAULT_CAP;
  const q = input.query.trim().toLowerCase();
  const hasQuery = q.length > 0;
  const groups: CommandGroupVM[] = [];

  if (hasQuery && permissions.bookings) {
    const matched = bookings.filter((b) =>
      matches([b.customerName, b.cleanerName, b.property, b.service, b.dateLabel].join(' '), q),
    );
    if (matched.length) {
      const items = matched.slice(0, cap).map<CommandItemVM>((b) => ({
        key: `booking:${b.id}`,
        label: b.property || b.service || 'Booking',
        sublabel: joinDot(b.customerName, b.dateLabel),
        icon: ClipboardList,
        group: 'Bookings',
        href: `/app/admin-dashboard/bookings?booking=${b.id}`,
      }));
      groups.push({ group: 'Bookings', items, overflow: matched.length - items.length });
    }
  }

  if (hasQuery && permissions.customers) {
    const matched = customers.filter((c) => matches([c.name, c.email, c.phone].join(' '), q));
    if (matched.length) {
      const items = matched.slice(0, cap).map<CommandItemVM>((c) => ({
        key: `customer:${c.id}`,
        label: c.name || c.email,
        sublabel: c.name ? c.email : c.phone,
        icon: BookUser,
        group: 'Customers',
        href: `/app/admin-dashboard/customers?customer=${c.id}`,
      }));
      groups.push({ group: 'Customers', items, overflow: matched.length - items.length });
    }
  }

  if (hasQuery && permissions.cleaners) {
    const matched = cleaners.filter((c) => matches([c.name, c.email, c.roleLabel].join(' '), q));
    if (matched.length) {
      const items = matched.slice(0, cap).map<CommandItemVM>((c) => ({
        key: `cleaner:${c.id}`,
        label: c.name || c.email,
        sublabel: c.roleLabel || c.email,
        icon: Users,
        group: 'Cleaners',
        href: `/app/admin-dashboard/cleaners?cleaner=${c.id}`,
      }));
      groups.push({ group: 'Cleaners', items, overflow: matched.length - items.length });
    }
  }

  if (hasQuery && permissions.services) {
    const matched = services.filter((s) => matches(s.name, q));
    if (matched.length) {
      const items = matched.slice(0, cap).map<CommandItemVM>((s) => ({
        key: `service:${s.id}`,
        label: s.name,
        sublabel: s.priceLabel || undefined,
        icon: Tag,
        group: 'Services',
        href: `/app/admin-dashboard/services?service=${s.id}`,
      }));
      groups.push({ group: 'Services', items, overflow: matched.length - items.length });
    }
  }

  // Actions + navigation. Empty query shows them all (quick launcher);
  // a query filters by the action label/keywords and the raw nav label.
  const actionItems: CommandItemVM[] = [];
  for (const a of actions) {
    if (!hasQuery || matches(`${a.label} ${a.keywords ?? ''}`, q)) {
      actionItems.push({
        key: `action:${a.id}`,
        label: a.label,
        icon: a.icon,
        group: 'Actions',
        actionId: a.id,
      });
    }
  }
  for (const n of nav) {
    if (!hasQuery || matches(n.label, q)) {
      actionItems.push({
        key: `nav:${n.id}`,
        label: `Go to ${n.label}`,
        icon: n.icon,
        group: 'Actions',
        href: n.href,
      });
    }
  }
  if (actionItems.length) {
    groups.push({ group: 'Actions', items: actionItems, overflow: 0 });
  }

  return groups;
}
