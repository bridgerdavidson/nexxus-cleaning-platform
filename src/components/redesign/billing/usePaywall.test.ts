// The store behind the wall. These tests exist for one property:
//
//   THERE IS NO SEQUENCE OF CALLS AFTER WHICH THE WALL IS OPEN AND close()
//   DOES NOT CLOSE IT.
//
// The Asana failure (a "Your trial has ended" wall whose escape disappeared,
// left sitting on the customer's own data) is reproduced by exactly two
// mutations: making close() conditional, and making the re-open level triggered
// instead of edge triggered. Both have a dedicated test below.

import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  closePaywall,
  getPaywallSnapshot,
  openPaywall,
  resetPaywallStore,
  subscribePaywall,
  syncPaywallFrozen,
} from './usePaywall'

beforeEach(() => {
  resetPaywallStore()
})

describe('open and close', () => {
  it('starts closed', () => {
    expect(getPaywallSnapshot()).toBe(false)
  })

  it('opens and closes', () => {
    openPaywall()
    expect(getPaywallSnapshot()).toBe(true)
    closePaywall()
    expect(getPaywallSnapshot()).toBe(false)
  })

  it('notifies subscribers on each change, and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribePaywall(() => {
      calls += 1
    })
    openPaywall()
    closePaywall()
    expect(calls).toBe(2)
    unsubscribe()
    openPaywall()
    expect(calls).toBe(2)
  })

  it('does not notify when the state is unchanged', () => {
    let calls = 0
    subscribePaywall(() => {
      calls += 1
    })
    openPaywall()
    openPaywall()
    closePaywall()
    closePaywall()
    expect(calls).toBe(2)
  })
})

describe('close() can never be unavailable or ineffective', () => {
  it('closes a wall opened directly', () => {
    openPaywall()
    closePaywall()
    expect(getPaywallSnapshot()).toBe(false)
  })

  it('closes a wall opened by a frozen org', () => {
    syncPaywallFrozen(true)
    expect(getPaywallSnapshot()).toBe(true)
    closePaywall()
    expect(getPaywallSnapshot()).toBe(false)
  })

  // The specific regression the reviewer asked for: it must work the SECOND
  // time too. A close that only works once is the same trap one step later.
  it('closes again after a re-open, every time, while the org stays frozen', () => {
    syncPaywallFrozen(true)
    for (let round = 0; round < 5; round++) {
      closePaywall()
      expect(getPaywallSnapshot(), `round ${round} close`).toBe(false)
      openPaywall()
      expect(getPaywallSnapshot(), `round ${round} reopen`).toBe(true)
    }
    closePaywall()
    expect(getPaywallSnapshot()).toBe(false)
  })

  it('stays closed no matter how many times billing state is reported afterwards', () => {
    syncPaywallFrozen(true)
    closePaywall()
    // This is the render loop: the component reports the same frozen value on
    // every commit. A level-triggered re-open would flip it back here and the
    // user could never leave.
    for (let render = 0; render < 50; render++) syncPaywallFrozen(true)
    expect(getPaywallSnapshot()).toBe(false)
  })
})

describe('syncPaywallFrozen is edge triggered', () => {
  it('opens on the first observation of a frozen org', () => {
    syncPaywallFrozen(true)
    expect(getPaywallSnapshot()).toBe(true)
  })

  it('does not open for an org that is not frozen', () => {
    syncPaywallFrozen(false)
    expect(getPaywallSnapshot()).toBe(false)
  })

  it('opens when a trial expires while the tab is open (false then true)', () => {
    syncPaywallFrozen(false)
    expect(getPaywallSnapshot()).toBe(false)
    syncPaywallFrozen(true)
    expect(getPaywallSnapshot()).toBe(true)
  })

  it('closes itself when the org unfreezes (they paid, or extended the trial)', () => {
    syncPaywallFrozen(true)
    syncPaywallFrozen(false)
    expect(getPaywallSnapshot()).toBe(false)
  })

  it('re-opens on a genuine new edge after a dismissal', () => {
    syncPaywallFrozen(true)
    closePaywall()
    syncPaywallFrozen(false)
    syncPaywallFrozen(true)
    expect(getPaywallSnapshot()).toBe(true)
    closePaywall()
    expect(getPaywallSnapshot()).toBe(false)
  })
})

// The store is small enough that its danger is entirely in what someone might
// ADD to it later. These read the file as text.
describe('the source itself forbids the trap', () => {
  const source = readFileSync(new URL('./usePaywall.ts', import.meta.url), 'utf8')

  function bodyOf(name: string): string {
    const match = source.match(new RegExp(`export function ${name}\\([^)]*\\): void \\{([\\s\\S]*?)\\n\\}`))
    expect(match, `${name} not found`).not.toBeNull()
    return match![1]
  }

  it('closePaywall takes no arguments, so no caller can be refused', () => {
    expect(source).toMatch(/export function closePaywall\(\): void/)
  })

  it('closePaywall consults nothing: not billing state, not the role, not the flag', () => {
    const body = bodyOf('closePaywall')
    for (const forbidden of ['frozen', 'access', 'isOwner', 'uiEnabled', 'role', 'state']) {
      expect(body, forbidden).not.toContain(forbidden)
    }
  })

  it('exports plain functions, not a provider or a context', () => {
    expect(source).not.toContain('createContext')
    expect(source).not.toContain('Provider')
    expect(source).toContain('useSyncExternalStore')
  })

  // usePaywall itself needs React to run, so these hold it to its contract.
  it('hands the component the store snapshot and the two plain functions', () => {
    expect(source).toMatch(
      /const open = useSyncExternalStore\(subscribePaywall, getPaywallSnapshot, getPaywallServerSnapshot\)/,
    )
    expect(source).toMatch(/return \{ open: openPaywall, close: closePaywall, isOpen: open \}/)
  })

  it('renders no wall during SSR, before the client knows about a dismissal', () => {
    expect(source).toMatch(/function getPaywallServerSnapshot\(\): boolean \{\s*return false/)
  })

  it('writes no em dash', () => {
    expect(source).not.toContain('—')
  })
})
