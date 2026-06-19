import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('joins truthy classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })
  it('lets later tailwind classes win on conflict', () => {
    expect(cn('px-2 px-4')).toBe('px-4')
  })
  it('merges conditional objects', () => {
    expect(cn('p-2', { 'text-red-500': true, 'hidden': false })).toBe('p-2 text-red-500')
  })
})
