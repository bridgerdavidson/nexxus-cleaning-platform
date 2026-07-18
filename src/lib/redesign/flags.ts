/**
 * The redesign is the app now (cutover complete, Phase 4). This used to gate on
 * NEXT_PUBLIC_REDESIGN_ENABLED, but the flag is retired: the legacy tree is gone
 * and the redesign is unconditional. Kept as a stable `true` so the remaining
 * call sites (auth redirects, role guards, the platform "View as" push) don't
 * need touching in one PR; the redundant calls get swept in 4g.
 */
export function redesignUiEnabled(): boolean {
  return true;
}
