/**
 * Card/list label: base through base + largest checklist adder.
 * Single price when there is no positive adder on any checklist.
 */
export function formatServicePriceRangeLabel(
  basePrice: number,
  maxChecklistAdder: number
): string {
  const adder = Math.max(0, maxChecklistAdder);
  if (adder === 0) {
    return `$${basePrice.toFixed(2)}`;
  }
  const maxTotal = basePrice + adder;
  return `$${basePrice.toFixed(0)}–$${maxTotal.toFixed(0)}`;
}
