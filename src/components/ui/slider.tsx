'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/** Tokenized native range input (no Radix slider dependency in this repo). */
const Slider = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<'input'>, 'type'>>(
  ({ className, ...props }, ref) => (
    <input
      type="range"
      ref={ref}
      className={cn(
        'h-2 w-full cursor-pointer appearance-none rounded-pill bg-secondary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        '[&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow-soft-sm',
        '[&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-pill [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-card',
        className,
      )}
      {...props}
    />
  ),
)
Slider.displayName = 'Slider'

export { Slider }
