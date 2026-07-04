import * as React from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ErrorState({
  icon,
  title = "Couldn't load this",
  description = 'Something went wrong loading this. Please try again.',
  onRetry,
  action,
}: {
  icon?: React.ReactNode
  title?: string
  description?: string
  onRetry?: () => void
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <div className="mb-4 text-destructive [&_svg]:size-10">{icon ?? <TriangleAlert />}</div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ??
        (onRetry ? (
          <div className="mt-6">
            <Button variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null)}
    </div>
  )
}
