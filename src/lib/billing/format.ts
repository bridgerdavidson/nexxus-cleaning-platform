// Display formatting only. Every amount in this system is integer cents;
// nothing here is used for arithmetic.

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 10717 -> "$107.17". Negative amounts render as "-$25.00". */
export function formatCents(cents: number): string {
  return MONEY.format(cents / 100);
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** ISO -> "October 21, 2026". Empty string when absent or unparseable. */
export function formatBillingDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return DATE.format(d);
}
