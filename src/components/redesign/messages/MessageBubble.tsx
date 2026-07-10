'use client'

import { useState } from 'react'
import { Check, CheckCheck } from 'lucide-react'
import MessageAttachmentsLightbox from '@/components/MessageAttachmentsLightbox'
import { cn } from '@/lib/utils'
import { InlineBookingCard } from './InlineBookingCard'
import type { MessageVM } from './messages-types'

export function MessageBubble({
  message,
  onOpenBooking,
}: {
  message: MessageVM
  onOpenBooking?: (id: string) => void
}) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const mine = message.isMine

  return (
    <div className={cn('flex w-full flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {/* Inline booking card (above bubble) */}
      {message.booking && (
        <div className={cn('max-w-[80%]', mine ? 'self-end' : 'self-start')}>
          <InlineBookingCard
            booking={message.booking}
            onOpen={onOpenBooking ? () => onOpenBooking(message.booking!.appointmentId) : undefined}
          />
        </div>
      )}

      {/* Bubble + attachments + timestamp */}
      <div
        className={cn(
          'flex max-w-[78%] flex-col gap-1',
          mine ? 'items-end' : 'items-start',
        )}
      >
        {message.content && (
          <div
            className={cn(
              'whitespace-pre-wrap break-words rounded-card px-3.5 py-2 text-sm',
              mine
                ? 'rounded-br-sm bg-primary text-primary-foreground'
                : 'rounded-bl-sm border border-border bg-card text-foreground',
            )}
          >
            {message.content}
          </div>
        )}

        {message.attachments.length > 0 && (
          <div
            className={cn(
              'grid gap-1.5',
              message.attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
            )}
          >
            {message.attachments.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setLightbox(i)}
                className="overflow-hidden rounded-control border border-border"
              >
                <img src={a.url} alt="attachment" className="h-28 w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 px-1 text-[10.5px] text-muted-foreground">
          <span>{message.timeLabel}</span>
          {mine &&
            (message.isRead ? (
              <CheckCheck className="size-3.5 text-primary" aria-label="Read" />
            ) : (
              <Check className="size-3.5" aria-label="Sent" />
            ))}
        </div>
      </div>

      {/* Lightbox — scoped to this bubble's attachments */}
      {lightbox !== null && (
        <MessageAttachmentsLightbox
          open={lightbox !== null}
          index={lightbox}
          attachments={message.attachments.map((a) => ({
            id: a.id,
            file_url: a.url,
            file_type: 'image/jpeg',
            file_size: null,
            message_id: message.id,
            created_at: message.createdAt,
          }))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
