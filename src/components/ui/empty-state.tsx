import * as React from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      {icon ? (
        <div className="mb-4 text-muted-foreground [&_svg]:size-10">{icon}</div>
      ) : null}
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
