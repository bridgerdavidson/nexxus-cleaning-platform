// src/components/ui/badge.tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        default:   'bg-primary/10 text-primary',
        secondary: 'bg-secondary text-secondary-foreground',
        outline:   'border border-border text-foreground',
        positive:  'bg-positive-50 text-positive-700 dark:bg-positive/15 dark:text-positive',
        caution:   'bg-caution-50 text-caution-700 dark:bg-caution/15 dark:text-caution',
        critical:  'bg-critical-50 text-critical-700 dark:bg-critical/15 dark:text-destructive',
        info:      'bg-info-50 text-info-700 dark:bg-info/15 dark:text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
