"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import { Check, X, Info, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"

type ToasterProps = React.ComponentProps<typeof Sonner>

function IconChip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", className)}>
      {children}
    </span>
  )
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <IconChip className="bg-positive">
            <Check className="size-4 text-white" />
          </IconChip>
        ),
        error: (
          <IconChip className="bg-destructive">
            <X className="size-4 text-white" />
          </IconChip>
        ),
        info: (
          <IconChip className="bg-info">
            <Info className="size-4 text-white" />
          </IconChip>
        ),
        warning: (
          <IconChip className="bg-caution">
            <TriangleAlert className="size-4 text-white" />
          </IconChip>
        ),
      }}
      toastOptions={{
        classNames: {
          toast:
            "group flex items-start gap-3 rounded-card border border-border bg-popover p-4 text-popover-foreground shadow-soft-lg",
          title: "text-sm font-semibold text-foreground",
          description: "text-sm text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
// Re-export the toast API from the same sonner module instance the Toaster uses,
// so callers get a single shared toast store (one import surface for the kit).
export { toast } from "sonner"
