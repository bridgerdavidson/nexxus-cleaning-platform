'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Send, X, CalendarDays, ImagePlus } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { IconButton } from '@/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ReferenceBookingMenu } from './ReferenceBookingMenu'
import { cn } from '@/lib/utils'
import type { ContactBookingVM } from './messages-types'

const MAX_FILES = 5

export function MessageComposer(props: {
  draft: string
  onDraftChange: (v: string) => void
  pendingFiles: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
  stagedBooking: ContactBookingVM | null
  attachableBookings: ContactBookingVM[]
  onStageBooking: (id: string) => void
  onClearStagedBooking: () => void
  onSend: () => void
  sending: boolean
  isMobile: boolean
  /** Hide the "Reference a booking" affordance (cleaner has no contact-bookings to attach). Defaults to shown. */
  showReferenceBooking?: boolean
  /** Hide the "Add image" affordance (job threads are text-only). Defaults to shown. */
  showAddImage?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  const [objectUrls, setObjectUrls] = useState<string[]>([])
  useEffect(() => {
    const urls = props.pendingFiles.map((f) => URL.createObjectURL(f))
    setObjectUrls(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [props.pendingFiles])

  const canSend =
    (props.draft.trim().length > 0 || props.pendingFiles.length > 0 || !!props.stagedBooking) &&
    !props.sending

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) props.onSend()
    }
  }
  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_FILES - props.pendingFiles.length)
    if (files.length) props.onAddFiles(files)
    e.target.value = ''
  }

  return (
    <div className="border-t border-border/60 bg-card p-3">
      {props.stagedBooking && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-control border border-primary/25 bg-primary/10 py-1.5 pl-3 pr-1.5">
          <CalendarDays className="size-3.5 text-primary" aria-hidden />
          <span className="text-xs font-bold text-primary">
            {props.stagedBooking.service} · {props.stagedBooking.dateLabel}
          </span>
          <IconButton
            aria-label="Remove attached booking"
            className="h-5 w-5 bg-background"
            onClick={props.onClearStagedBooking}
          >
            <X className="size-3" />
          </IconButton>
        </div>
      )}
      {props.pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {props.pendingFiles.map((_, i) => (
            <div key={i} className="relative">
              {objectUrls[i] && (
                <img
                  src={objectUrls[i]}
                  alt=""
                  className="size-14 rounded-control object-cover"
                />
              )}
              <button
                type="button"
                onClick={() => props.onRemoveFile(i)}
                aria-label="Remove image"
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-card border border-border bg-card p-1.5 shadow-soft-sm">
        {(props.showAddImage !== false || props.showReferenceBooking !== false) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="Add to message" className="h-9 w-9 shrink-0 bg-primary/10 text-primary">
                <Plus className="size-5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              {props.showAddImage !== false && (
                <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                  <ImagePlus className="size-4" />
                  Add image
                </DropdownMenuItem>
              )}
              {props.showReferenceBooking !== false && (
                <ReferenceBookingMenu
                  isMobile={props.isMobile}
                  bookings={props.attachableBookings}
                  onPick={props.onStageBooking}
                  trigger={
                    <DropdownMenuItem onSelect={(e: Event) => e.preventDefault()}>
                      <CalendarDays className="size-4" />
                      Reference a booking
                    </DropdownMenuItem>
                  }
                />
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handleFiles} />
        <Textarea
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message"
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent px-1 py-2 focus-visible:ring-0"
        />
        <IconButton
          aria-label="Send message"
          loading={props.sending}
          disabled={!canSend}
          className={cn(
            'h-9 w-9 shrink-0',
            // While sending, keep the primary look (the spinner is the busy
            // signal); the muted look means "nothing to send", not "working".
            canSend || props.sending
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground',
          )}
          onClick={props.onSend}
        >
          <Send className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}
