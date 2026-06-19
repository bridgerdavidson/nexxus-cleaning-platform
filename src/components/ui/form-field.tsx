// src/components/ui/form-field.tsx
import * as React from 'react'
import { Label } from './label'
import { cn } from '@/lib/utils'

export interface FormFieldProps {
  label: string
  htmlFor: string
  helper?: string
  error?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function FormField({ label, htmlFor, helper, error, required, className, children }: FormFieldProps) {
  const describedBy = error ? `${htmlFor}-error` : helper ? `${htmlFor}-helper` : undefined
  const control =
    React.isValidElement(children) && (describedBy || error)
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          'aria-describedby': [(children as React.ReactElement<Record<string, unknown>>).props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
          ...(error ? { 'aria-invalid': true } : {}),
        })
      : children
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-destructive" aria-hidden>*</span> : null}
      </Label>
      {control}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm font-medium text-destructive">{error}</p>
      ) : helper ? (
        <p id={`${htmlFor}-helper`} className="text-sm text-muted-foreground">{helper}</p>
      ) : null}
    </div>
  )
}
