import { describe, expect, it } from 'vitest'
import { EXTRA_SEAT_PRICE, PRICING_TIERS, overCap, tierTotal } from './pricing'

const [starter, growth, pro] = PRICING_TIERS

describe('PRICING_TIERS', () => {
  it('matches the locked 2026-07-26 pricing decision', () => {
    expect(PRICING_TIERS.map((t) => t.name)).toEqual(['Starter', 'Growth', 'Pro'])
    expect(starter.bases).toEqual({ annual: 29, monthly: 39 })
    expect(growth.bases).toEqual({ annual: 79, monthly: 99 })
    expect(pro.bases).toEqual({ annual: 139, monthly: 169 })
    expect(PRICING_TIERS.map((t) => t.includedSeats)).toEqual([3, 8, 15])
    expect(PRICING_TIERS.map((t) => t.cap)).toEqual([5, 15, null])
    expect(EXTRA_SEAT_PRICE).toBe(10)
  })
  it('keeps copy free of em dashes', () => {
    const strings = PRICING_TIERS.flatMap((t) => [t.name, t.blurb, ...t.features])
    for (const s of strings) expect(s).not.toContain('—')
  })
})

describe('tierTotal', () => {
  it('charges the base alone at or under the included seats', () => {
    expect(tierTotal(starter, 'annual', 3)).toBe(29)
    expect(tierTotal(starter, 'monthly', 1)).toBe(39)
    expect(tierTotal(growth, 'annual', 8)).toBe(79)
    expect(tierTotal(pro, 'monthly', 15)).toBe(169)
  })
  it('adds a flat $10 per seat beyond included', () => {
    expect(tierTotal(starter, 'annual', 5)).toBe(29 + 2 * EXTRA_SEAT_PRICE)
    expect(tierTotal(growth, 'monthly', 10)).toBe(99 + 2 * EXTRA_SEAT_PRICE)
    expect(tierTotal(pro, 'annual', 20)).toBe(139 + 5 * EXTRA_SEAT_PRICE)
  })
})

describe('overCap', () => {
  it('flags Starter above 5 and Growth above 15, at the boundary not before', () => {
    expect(overCap(starter, 5)).toBe(false)
    expect(overCap(starter, 6)).toBe(true)
    expect(overCap(growth, 15)).toBe(false)
    expect(overCap(growth, 16)).toBe(true)
  })
  it('never flags Pro (unlimited)', () => {
    expect(overCap(pro, 25)).toBe(false)
  })
})
