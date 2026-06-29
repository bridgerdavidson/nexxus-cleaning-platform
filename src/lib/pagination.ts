export const PAYMENTS_PAGE_SIZE = 25;

/** Supabase `.range()` bounds for a zero-based page index. */
export function pageRange(pageIndex: number, pageSize: number): { from: number; to: number } {
  const from = pageIndex * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** Next page index for useInfiniteQuery; undefined once all rows are loaded.
 *  Count-aware (uses the exact total from `{ count: 'exact' }`) so an exact
 *  page-size multiple does not trigger a wasted empty fetch. */
export function nextPageParam(
  loadedCount: number,
  total: number,
  pagesLoaded: number,
): number | undefined {
  return loadedCount < total ? pagesLoaded : undefined;
}
