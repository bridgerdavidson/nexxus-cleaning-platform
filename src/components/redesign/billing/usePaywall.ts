'use client'

// The paywall's open/closed state, as a MODULE-LEVEL STORE rather than a React
// context. Task 12's 402 net opens this wall from billing-api.ts, a plain async
// module with no React tree, so a context could not reach it. There is no
// provider; `openPaywall()` and `closePaywall()` are callable from anywhere,
// and `usePaywall()` subscribes a component to the same state.
//
// ⚠ THE RULE THIS FILE EXISTS TO KEEP: close() always works.
//
// Asana shipped a trial-expiry modal whose "go back to a free plan" escape
// silently disappeared for some accounts, leaving a wall sitting on top of the
// customer's own data with no way out. Their complaint thread ran for years.
// Our wall covers a working cleaning company's schedule.
//
// Two properties make that impossible here:
//   1. `closePaywall()` has no conditions. It cannot consult billing state, the
//      user's role, or a flag, because none of those are inputs to it.
//   2. Re-opening is EDGE triggered, never level triggered. `syncPaywallFrozen`
//      only acts when the frozen flag CHANGES, so a frozen org that dismisses
//      the wall stays dismissed across every subsequent render. A level-triggered
//      version ("if frozen, open") would reopen on the next render and reproduce
//      the Asana trap exactly.

import { useSyncExternalStore } from 'react'

type Listener = () => void

let isOpen = false
/**
 * The last `frozen` value we acted on. null means "not observed yet", so the
 * first observation of a frozen org counts as an edge and opens the wall.
 */
let lastFrozen: boolean | null = null

const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Opens the wall. Safe to call from anywhere, including non-React code. */
export function openPaywall(): void {
  if (isOpen) return
  isOpen = true
  emit()
}

/**
 * Closes the wall. Unconditional, by design and permanently. Do not add a
 * guard here, do not take an argument here, and do not make any caller's
 * ability to call it depend on billing state.
 */
export function closePaywall(): void {
  if (!isOpen) return
  isOpen = false
  emit()
}

export function subscribePaywall(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPaywallSnapshot(): boolean {
  return isOpen
}

/** SSR has no wall: the server never knows whether this user dismissed it. */
function getPaywallServerSnapshot(): boolean {
  return false
}

/**
 * Feeds billing state in. Opens on the transition INTO frozen (including the
 * first observation, which is how a frozen org gets the wall on load) and
 * closes on the transition out of it (they paid, or extended the trial).
 *
 * Calling it repeatedly with the same value does nothing, which is the whole
 * point: it is what lets a dismissal survive.
 */
export function syncPaywallFrozen(frozen: boolean): void {
  if (lastFrozen === frozen) return
  lastFrozen = frozen
  if (frozen) openPaywall()
  else closePaywall()
}

/** Test-only. Clears both the open state and the edge tracker. */
export function resetPaywallStore(): void {
  isOpen = false
  lastFrozen = null
  emit()
}

export interface PaywallHandle {
  open: () => void
  close: () => void
  isOpen: boolean
}

export function usePaywall(): PaywallHandle {
  const open = useSyncExternalStore(subscribePaywall, getPaywallSnapshot, getPaywallServerSnapshot)
  return { open: openPaywall, close: closePaywall, isOpen: open }
}
