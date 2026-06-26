import { describe, it, expect } from 'vitest';
import { Plus, ArrowRight } from 'lucide-react';
import {
  deriveCommandResults,
  type DeriveCommandInput,
  type PaletteBooking,
  type PaletteCustomer,
} from './deriveCommandResults';

const NAV = [
  { id: 'bookings', label: 'Bookings', href: '/app/admin-dashboard/bookings', icon: ArrowRight },
  { id: 'payments', label: 'Payments & payouts', href: '/app/admin-dashboard/payments', icon: ArrowRight },
];
const ACTIONS = [{ id: 'new-booking', label: 'New booking', keywords: 'create add', icon: Plus }];

const ALL = { bookings: true, customers: true, cleaners: true, services: true };

function input(over: Partial<DeriveCommandInput> = {}): DeriveCommandInput {
  return {
    query: '',
    bookings: [],
    customers: [],
    cleaners: [],
    services: [],
    permissions: ALL,
    nav: NAV,
    actions: ACTIONS,
    ...over,
  };
}

const customer = (over: Partial<PaletteCustomer> = {}): PaletteCustomer => ({
  id: 'c1',
  name: 'Jordan Avery',
  email: 'jordan@example.com',
  phone: '801-555-0142',
  ...over,
});

const booking = (over: Partial<PaletteBooking> = {}): PaletteBooking => ({
  id: 'b1',
  customerName: 'Jordan Avery',
  cleanerName: 'Wanda Jacobs',
  property: '123 Oak St',
  service: 'Deep clean',
  dateLabel: 'Jun 27',
  ...over,
});

describe('deriveCommandResults', () => {
  it('shows only the Actions group (nav + actions) for an empty query', () => {
    const groups = deriveCommandResults(input({ customers: [customer()], bookings: [booking()] }));
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe('Actions');
    const keys = groups[0].items.map((i) => i.key);
    expect(keys).toContain('action:new-booking');
    expect(keys).toContain('nav:bookings');
    expect(keys).toContain('nav:payments');
  });

  it('matches an entity by a substring and builds the deep-link href', () => {
    const groups = deriveCommandResults(input({ query: 'oak', bookings: [booking()] }));
    const bookingsGroup = groups.find((g) => g.group === 'Bookings');
    expect(bookingsGroup).toBeDefined();
    expect(bookingsGroup!.items[0].key).toBe('booking:b1');
    expect(bookingsGroup!.items[0].href).toBe('/app/admin-dashboard/bookings?booking=b1');
    expect(bookingsGroup!.items[0].label).toBe('123 Oak St');
  });

  it('searches customers across name, email and phone', () => {
    const byEmail = deriveCommandResults(input({ query: 'jordan@', customers: [customer()] }));
    expect(byEmail.find((g) => g.group === 'Customers')?.items[0].key).toBe('customer:c1');
    const byPhone = deriveCommandResults(input({ query: '0142', customers: [customer()] }));
    expect(byPhone.find((g) => g.group === 'Customers')?.items[0].key).toBe('customer:c1');
  });

  it('excludes an entity group the user lacks permission to view', () => {
    const groups = deriveCommandResults(
      input({
        query: 'jordan',
        customers: [customer()],
        permissions: { ...ALL, customers: false },
      }),
    );
    expect(groups.find((g) => g.group === 'Customers')).toBeUndefined();
  });

  it('caps a group and reports the overflow count', () => {
    const many = Array.from({ length: 7 }, (_, i) => booking({ id: `b${i}`, property: `Oak ${i}` }));
    const groups = deriveCommandResults(input({ query: 'oak', bookings: many, cap: 5 }));
    const g = groups.find((x) => x.group === 'Bookings')!;
    expect(g.items).toHaveLength(5);
    expect(g.overflow).toBe(2);
  });

  it('filters actions and nav by the query too', () => {
    const groups = deriveCommandResults(input({ query: 'pay' }));
    const actions = groups.find((g) => g.group === 'Actions')!;
    const keys = actions.items.map((i) => i.key);
    expect(keys).toContain('nav:payments'); // "Payments & payouts" matches "pay"
    expect(keys).not.toContain('action:new-booking'); // no "pay"
    expect(keys).not.toContain('nav:bookings');
  });

  it('matches an action by its keywords', () => {
    const groups = deriveCommandResults(input({ query: 'create' }));
    const actions = groups.find((g) => g.group === 'Actions')!;
    expect(actions.items.map((i) => i.key)).toContain('action:new-booking'); // keyword "create"
  });

  it('orders entity groups Bookings before Customers', () => {
    const groups = deriveCommandResults(
      input({ query: 'jordan', bookings: [booking()], customers: [customer()] }),
    );
    // "jordan" matches no action/nav, so the Actions group is omitted.
    expect(groups.map((g) => g.group)).toEqual(['Bookings', 'Customers']);
  });

  it('puts the Actions group last when entities and actions both match', () => {
    // "a" matches Avery (booking + customer), "Payments & payouts", and the
    // "add" keyword on New booking.
    const groups = deriveCommandResults(
      input({ query: 'a', bookings: [booking()], customers: [customer()] }),
    );
    const order = groups.map((g) => g.group);
    expect(order).toContain('Bookings');
    expect(order).toContain('Customers');
    expect(order[order.length - 1]).toBe('Actions');
  });

  it('omits entity groups with no matches', () => {
    const groups = deriveCommandResults(input({ query: 'zzzznotfound', customers: [customer()] }));
    // no entity matches, and no action/nav matches -> no groups at all
    expect(groups).toHaveLength(0);
  });
});
