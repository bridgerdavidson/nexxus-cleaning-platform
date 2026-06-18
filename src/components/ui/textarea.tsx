// src/components/ui/textarea.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-24 w-full rounded-field border border-input bg-card px-4 py-3 text-base text-foreground transition-colors duration-base placeholder:text-muted-foreground resize-y',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
export { Textarea }
