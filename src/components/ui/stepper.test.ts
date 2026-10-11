import { describe, it, expect } from 'vitest'
import { nextStepperValue } from './stepper'

describe('nextStepperValue', () => {
  it('refuses to go below min', () => {
    expect(nextStepperValue(6, -1, 6, 15)).toBeNull()
  })
  it('refuses to go above max', () => {
    expect(nextStepperValue(15, 1, 6, 15)).toBeNull()
  })
  it('treats a null max as unbounded', () => {
    expect(nextStepperValue(99, 1, 1, null)).toBe(100)
  })
  it('steps within bounds', () => {
    expect(nextStepperValue(8, 1, 6, 15)).toBe(9)
    expect(nextStepperValue(8, -1, 6, 15)).toBe(7)
  })
  it('refuses any move when min equals max', () => {
    expect(nextStepperValue(5, 1, 5, 5)).toBeNull()
    expect(nextStepperValue(5, -1, 5, 5)).toBeNull()
  })
})
