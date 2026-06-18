'use client'

import * as React from 'react'
import { Button, type ButtonProps } from './button'

export interface IconButtonProps extends Omit<ButtonProps, 'size'> {
  'aria-label': string
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', ...props }, ref) => (
    <Button ref={ref} size="icon" variant={variant} {...props} />
  ),
)
IconButton.displayName = 'IconButton'

export { IconButton }
