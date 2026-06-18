'use client'

// src/components/ui/sheet.tsx
import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetPortal = SheetPrimitive.Portal
const SheetClose = SheetPrimitive.Close

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetSideVariants = {
  top: cn(
    'inset-x-0 top-0 border-b border-border',
    'data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
  ),
  bottom: cn(
    'inset-x-0 bottom-0 border-t border-border rounded-t-card',
    'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  ),
  left: cn(
    'inset-y-0 left-0 h-full w-3/4 border-r border-border rounded-r-card sm:max-w-sm',
    'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
  ),
  right: cn(
    'inset-y-0 right-0 h-full w-3/4 border-l border-border rounded-l-card sm:max-w-sm',
    'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  ),
} as const

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  side?: keyof typeof sheetSideVariants
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        'redesign-overlay',
        'fixed z-50 flex flex-col',
        'bg-popover text-popover-foreground shadow-soft-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:duration-200 data-[state=open]:duration-300',
        sheetSideVariants[side],
        className,
      )}
      {...props}
    >
      {children}
      <SheetPrimitive.Close
        type="button"
        aria-label="Close"
        className={cn(
          'absolute right-4 top-4 rounded-pill p-1.5',
          'text-muted-foreground transition-colors duration-base',
          'hover:bg-muted hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
          'disabled:pointer-events-none',
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col gap-1.5 px-6 pt-6 pb-4', className)}
    {...props}
  />
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 px-6 pb-6 pt-4 sm:flex-row sm:justify-end', className)}
    {...props}
  />
)
SheetFooter.displayName = 'SheetFooter'

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('text-xl font-bold text-popover-foreground', className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetTrigger,
  SheetPortal,
  SheetOverlay,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
